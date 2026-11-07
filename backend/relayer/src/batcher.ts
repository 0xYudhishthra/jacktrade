import type { PriceStore, PriceUpdate } from "@hm/prices";
import { deployment, pythToWad, safeError, type getNetwork, type RejectCode } from "@hm/shared";
import { decodeErrorResult, encodeFunctionData, formatTransactionReceipt, keccak256, parseEventLogs, type Account, type Hex, type TransactionReceipt, type WalletClient } from "viem";

import type { ChainState } from "./chain.js";
import type { IntentQueue, QueuedIntent } from "./queue.js";

type Client = ReturnType<typeof getNetwork>["client"];

const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
const executor = { address: deployment.contracts.BatchExecutor.address, abi: deployment.contracts.BatchExecutor.abi } as const;
const oracle = { address: deployment.contracts.PriceOracle.address, abi: deployment.contracts.PriceOracle.abi } as const;

export type BatcherOptions = {
  client: Client;
  wallet: WalletClient & { account: Account };
  chain: ChainState;
  prices: PriceStore;
  queue: IntentQueue;
  feedIds: readonly Hex[];
  feedIdOf: (instrumentId: number) => Hex | undefined;
  intervalMs: number; // cada cuánto se arma un batch
  gasBase: bigint; // gas fijo del batch (update de Pyth y overhead)
  gasPerCall: bigint; // gas reservado por intent
  maxBatch: number; // intents por transacción
  maxPriceWaitMs: number; // cuánto puede esperar un intent un precio posterior a su firma
  receiptTimeoutMs: number; // tope de espera del recibo antes de seguir con el próximo batch
  /** Se corre después de cada batch, en el mismo loop: las acciones firmadas usan la misma wallet sin pisar nonces. */
  afterBatch?: () => Promise<void>;
};

/** Arma un batch por vez: precio de Pyth posterior a las firmas, simulación, envío y estado de cada intent. */
export function startBatcher(o: BatcherOptions) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const state: BatcherState = { lastError: undefined };

  let lastLoopAt = Date.now();
  const loop = async () => {
    lastLoopAt = Date.now();
    try {
      expireWaiting(o, state);
      await runBatch(o, state);
    } catch (e) {
      state.lastError = { message: classify(e), at: Date.now() };
      console.error(`[batch] error: ${state.lastError.message}`);
    }
    // Aparte: un batch que falla no frena retiros ni depósitos, y una acción que falla no frena los batches.
    try {
      await o.afterBatch?.();
    } catch (e) {
      console.error(`[acción] error: ${safeError(e)}`);
    }
    if (!stopped) timer = setTimeout(loop, o.intervalMs);
  };
  void loop();

  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
    lastError: () => state.lastError,
    lastLoopAt: () => lastLoopAt,
  };
}

type BatcherState = { lastError: { message: string; at: number } | undefined };

function expireWaiting(o: BatcherOptions, state: BatcherState) {
  // Si los batches vienen fallando por un problema del relayer (sin ETH, sin rol, RPC caído), el estado lo dice:
  // no es que "no llegó el precio".
  const relayerProblem = state.lastError && Date.now() - state.lastError.at < 30_000 ? state.lastError.message : undefined;
  for (const q of o.queue.takeExpired(o.maxPriceWaitMs)) {
    o.queue.setStatus(
      relayerProblem
        ? { id: q.id, status: "failed", code: "Unknown", message: `the relayer could not send the batch: ${relayerProblem}` }
        : { id: q.id, status: "failed", code: "NoPrice", message: `no Pyth price newer than the signature arrived within ${o.maxPriceWaitMs} ms` },
    );
    console.log(`[batch] ${q.id} vencido: ${relayerProblem ?? "sin precio a tiempo"}`);
  }
}

async function runBatch(o: BatcherOptions, state: BatcherState) {
  if (o.queue.size === 0) return;

  // Cada intent espera el precio de SU mercado: publicado en o después de su firma (el contrato pide publishTime >= signedAt)
  // y con la cadena ya en esa hora (pide signedAt <= block.timestamp). Un feed atrasado no traba a los demás mercados.
  const latest = new Map(o.feedIds.map((id) => [id, o.prices.latest(id)] as const));
  const chainNow = Math.floor(o.chain.now());
  const batch = o.queue.takeWhere((q) => {
    const u = latest.get(o.feedIdOf(q.instrumentId)!);
    return !!u && Number(q.intent.intent.signedAt) <= Math.min(u.publishTime, chainNow);
  }, o.maxBatch);
  if (batch.length === 0) return;
  try {
    await sendBatch(o, state, batch, latest);
  } catch (e) {
    // Cualquier error antes de mandar (RPC caído en la simulación o en el fee): los intents vuelven a la fila
    // y vencen como corresponde, en vez de quedar "queued" para siempre.
    o.queue.putBack(batch.filter((q) => o.queue.status(q.id)?.status === "queued"));
    throw e;
  }
}

async function sendBatch(o: BatcherOptions, state: BatcherState, taken: QueuedIntent[], latest: Map<Hex, PriceUpdate | undefined>) {
  let batch = taken;
  // EIP-7702: una cuenta pudo delegar a un contrato después de validarse como EOA. Su firma correría código del usuario
  // (podría quemar el gas del batch), así que se vuelve a mirar y, si ahora tiene código, va sola en su batch.
  const nowCode = await Promise.all(batch.map((q) => (q.walletHasCode ? Promise.resolve(true) : o.chain.hasCode(q.intent.intent.user))));
  batch.forEach((q, i) => {
    if (nowCode[i] && !q.walletHasCode) {
      q.walletHasCode = true;
      console.log(`⚠ [batch] ${q.id}: la wallet ahora tiene código (EIP-7702): va sola`);
    }
  });

  // Wallets con código (contrato o EIP-7702): la validación de su firma corre código del usuario, que puede quemar el gas
  // del batch y hacer fallar a los demás. Van de a una, en su propio batch.
  const eoa = batch.filter((q) => !q.walletHasCode);
  if (eoa.length > 0) {
    o.queue.putBack(batch.filter((q) => q.walletHasCode));
    batch = eoa;
  } else {
    o.queue.putBack(batch.slice(1));
    batch = batch.slice(0, 1);
  }

  // Solo los feeds que usa este batch (se paga el fee de Pyth por cada uno).
  const used = [...new Set(batch.map((q) => o.feedIdOf(q.instrumentId)!))];
  const updates = used.map((id) => latest.get(id)!);
  const updateData = [...new Set(updates.map((u) => u.updateData))];
  const fee = await o.client.readContract({ ...oracle, functionName: "getUpdateFee", args: [updateData] });

  // No se usa el gas estimado: como un fallo interno no revierte el batch, estimateGas encuentra el mínimo con el que
  // execute "termina bien" aunque las llamadas de adentro se queden sin gas. Se reserva gas por intent (solo se paga el usado).
  const gasFor = (n: number) => o.gasBase + o.gasPerCall * BigInt(n);
  const executeData = (items: QueuedIntent[]) =>
    encodeFunctionData({ abi: executor.abi, functionName: "execute", args: [updateData, items.map(toCall)] });
  const simulate = async (items: QueuedIntent[]) =>
    (
      await o.client.simulateBlocks({
        blocks: [{ calls: [{ account: o.wallet.account, to: executor.address, data: executeData(items), value: fee, gas: gasFor(items.length) }] }],
      })
    )[0]!.calls[0]!;

  // Simular con eth_simulateV1, que devuelve los eventos: así se sabe por qué fallaría cada intent (CallFailed).
  // Los errores de tiempo se reintentan en el próximo batch; el resto falla con su código.
  for (;;) {
    const call = await simulate(batch);
    if (call.status !== "success") {
      const reason = revertName(call.data, call.error);
      // Problema del relayer (sin rol, fee, fondos): no es culpa de ningún intent. Vuelven todos y se reintenta.
      if (RELAYER_ERRORS.has(reason) || /insufficient funds/i.test(call.error?.message ?? "")) {
        o.queue.putBack(batch);
        throw new Error(`the batch simulation reverted: ${reason}`);
      }
      // Si no, algún intent hace revertir todo el batch: se prueban de a uno para sacar solo a los culpables.
      const ok: QueuedIntent[] = [];
      for (const q of batch) {
        const single = batch.length === 1 ? call : await simulate([q]);
        if (single.status === "success") ok.push(q);
        else {
          o.queue.setStatus({ id: q.id, status: "failed", code: "Unknown", message: `makes the batch revert: ${revertName(single.data, single.error)}` });
          console.log(`⚠ [batch] ${q.id} hace revertir el batch entero (${revertName(single.data, single.error)}): se descarta`);
        }
      }
      batch = ok;
      if (batch.length === 0) return;
      continue;
    }
    const failures = new Map(
      parseEventLogs({ abi: executor.abi, logs: call.logs ?? [], eventName: "CallFailed" }).map((l) => [Number(l.args.index), decodeReason(l.args.reason)]),
    );
    if (failures.size === 0) break;

    const retry: QueuedIntent[] = [];
    batch.forEach((q, i) => {
      const f = failures.get(i);
      if (!f) return;
      if (RETRYABLE.has(f.name)) {
        retry.push(q);
        console.log(`[batch] ${q.id} fallaría por ${f.name}: se reintenta en el próximo batch`);
      } else {
        o.queue.setStatus({ id: q.id, status: "failed", code: f.code, message: `would fail on-chain: ${f.name}` });
        console.log(`[batch] ${q.id} fallaría por ${f.name}: se descarta`);
      }
    });
    // Vuelven con su receivedAt original: si el problema sigue, vencen igual a los RELAYER_PRICE_WAIT_MS.
    o.queue.putBack(retry);
    batch = batch.filter((_, i) => !failures.has(i));
    if (batch.length === 0) return;
  }

  const t0 = Date.now();
  // Camino rápido: la transacción se firma acá y se manda con eth_sendRawTransactionSync, que devuelve el recibo en
  // la misma llamada (~100-300 ms en Robinhood Chain; esperar el recibo por polling sumaba ~2,5 s por trade). Como el
  // hash se conoce antes de mandarla, cualquier falla del método rápido cae a eth_sendRawTransaction con LA MISMA
  // transacción firmada y polling del recibo cada 100 ms: un problema del camino rápido nunca tira un trade.
  if (syncSend) {
    let hash: Hex | undefined;
    try {
      const request = await o.wallet.prepareTransactionRequest({
        account: o.wallet.account,
        chain: o.wallet.chain,
        to: executor.address,
        data: executeData(batch),
        value: fee,
        gas: gasFor(batch.length),
      });
      const serialized = await o.wallet.signTransaction(request as never);
      hash = keccak256(serialized);
      let receipt: TransactionReceipt;
      try {
        if (Date.now() < syncOffUntil) throw new Error("sync send paused");
        receipt = formatTransactionReceipt((await sendRawSync(serialized)) as never);
        if (receipt.transactionHash !== hash) throw new Error("sync receipt for another transaction");
      } catch (e) {
        if (Date.now() >= syncOffUntil) {
          // Con un tope corto y apagado unos minutos: un RPC que no lo soporta o no contesta no puede sumar segundos a cada trade.
          syncOffUntil = Date.now() + SYNC_PAUSE_MS;
          console.warn(`[batch] eth_sendRawTransactionSync no anduvo (${(e as Error).message?.split("\n")[0]}): se manda igual y se espera el recibo; se reintenta en ${SYNC_PAUSE_MS / 60_000} min`);
        }
        await o.client.sendRawTransaction({ serializedTransaction: serialized }).catch((err: Error) => {
          // Ya difundida por el intento anterior: no es un error.
          if (!/already known|nonce too low|known transaction/i.test(err.message)) throw err;
        });
        receipt = await pollReceipt(o, hash);
      }
      for (const q of batch) o.queue.setStatus({ id: q.id, status: "submitted", txHash: hash });
      console.log(`[batch] enviado y minado en ${Date.now() - t0} ms · ${batch.length} intent(s) · tx ${hash}`);
      state.lastError = undefined;
      applyReceipt(o, batch, updates, hash, receipt);
      return;
    } catch (e) {
      // Sin recibo: puede haber salido igual. Se concilia por nonce antes de reintentar.
      await new Promise((r) => setTimeout(r, 1000));
      const pending = await reconcileByNonce(o, batch, updates, hash);
      o.queue.putBack(pending);
      throw e;
    }
  }
  let txHash: Hex;
  try {
    txHash = await o.wallet.sendTransaction({
      account: o.wallet.account,
      chain: o.wallet.chain,
      to: executor.address,
      data: executeData(batch),
      value: fee,
      gas: gasFor(batch.length),
    });
  } catch (e) {
    // El envío falló, pero puede que la transacción haya salido igual (timeout del RPC después de difundirla).
    // Antes de reenviar se mira en la cadena qué nonces de intent ya se usaron: esos se ejecutaron.
    await new Promise((r) => setTimeout(r, 2000));
    const pending = await reconcileByNonce(o, batch, updates, undefined);
    o.queue.putBack(pending);
    throw e;
  }
  for (const q of batch) o.queue.setStatus({ id: q.id, status: "submitted", txHash });
  console.log(`[batch] enviado ${batch.length} intent(s) · tx ${txHash}`);
  state.lastError = undefined;

  // Esperar el recibo con un tope: una transacción trabada no puede frenar a todos los demás.
  const t1 = Date.now();
  try {
    const receipt = await o.client.waitForTransactionReceipt({ hash: txHash, timeout: o.receiptTimeoutMs });
    console.log(`[batch] envío ${t1 - t0} ms · espera del recibo ${Date.now() - t1} ms`);
    applyReceipt(o, batch, updates, txHash, receipt);
  } catch {
    console.warn(`⚠ ALERTA [batch] tx ${txHash} sin recibo en ${o.receiptTimeoutMs} ms: se sigue esperando en segundo plano`);
    void o.client
      .waitForTransactionReceipt({ hash: txHash, timeout: 10 * 60_000 })
      .then((receipt) => applyReceipt(o, batch, updates, txHash, receipt))
      .catch(async () => {
        console.error(`⚠ ALERTA [batch] tx ${txHash} no se confirmó en 10 min: se concilia por nonce`);
        await reconcileByNonce(o, batch, updates, txHash).then((pending) => {
          for (const q of pending) o.queue.setStatus({ id: q.id, status: "failed", txHash, code: "Unknown", message: "the transaction was not confirmed" });
        });
      });
  }
}

let syncSend = process.env.RELAYER_SYNC_SEND !== "0";
let syncOffUntil = 0;
const SYNC_PAUSE_MS = 5 * 60_000;
// eth_sendRawTransactionSync va directo al RPC de la cadena, que lo soporta (Alchemy no), sin los reintentos ni el
// fallback del transporte de viem: así una falla tarda como mucho SYNC_TIMEOUT_MS, no los ~16 s que se vieron en prod.
const SYNC_RPC_URL = process.env.RELAYER_SYNC_RPC_URL ?? deployment.rpcUrl;
const SYNC_TIMEOUT_MS = Number(process.env.RELAYER_SYNC_TIMEOUT_MS ?? 2_500);
async function sendRawSync(serialized: Hex) {
  const res = await fetch(SYNC_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransactionSync", params: [serialized] }),
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (!body.result) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body.result;
}

/** Recibo de una transacción ya difundida, consultado cada 100 ms hasta receiptTimeoutMs. */
async function pollReceipt(o: BatcherOptions, hash: Hex) {
  const end = Date.now() + o.receiptTimeoutMs;
  for (;;) {
    const receipt = await o.client.getTransactionReceipt({ hash }).catch(() => undefined);
    if (receipt) return receipt;
    if (Date.now() > end) throw new Error(`no receipt for ${hash} in ${o.receiptTimeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Los intents cuyo nonce ya se usó en la cadena se marcan ejecutados; devuelve los que no. */
async function reconcileByNonce(o: BatcherOptions, batch: QueuedIntent[], updates: PriceUpdate[], txHash: Hex | undefined) {
  const pending: QueuedIntent[] = [];
  for (const q of batch) {
    const used = await o.client
      .readContract({ ...exchange, functionName: "nonceUsed", args: [q.intent.intent.user, q.intent.intent.nonce] })
      .catch(() => false);
    if (!used) {
      pending.push(q);
      continue;
    }
    const u = updates.find((x) => x.feedId === o.feedIdOf(q.instrumentId));
    o.queue.setStatus({
      id: q.id,
      status: "executed",
      txHash: txHash ?? ("0x" as Hex),
      price: u ? safeWad(u).toString() : "0",
      publishTime: u?.publishTime ?? 0,
    });
    console.log(`[batch] ${q.id} ya estaba ejecutado en la cadena (nonce usado)`);
  }
  return pending;
}

function applyReceipt(o: BatcherOptions, batch: QueuedIntent[], updates: PriceUpdate[], txHash: Hex, receipt: TransactionReceipt) {
  if (receipt.status !== "success") {
    for (const q of batch) o.queue.setStatus({ id: q.id, status: "failed", txHash, code: "Unknown", message: "the batch transaction reverted" });
    console.log(`⚠ ALERTA [batch] tx ${txHash} revirtió`);
    return;
  }

  // Llamadas que fallaron dentro del batch (el resto del batch sigue), con el error del contrato decodificado.
  const failures = new Map(
    parseEventLogs({ abi: executor.abi, logs: receipt.logs, eventName: "CallFailed" }).map((l) => [Number(l.args.index), decodeReason(l.args.reason)]),
  );
  // `execute` no devuelve el positionId: sale de PositionOpened. Los eventos vienen en el orden de las llamadas,
  // y cada open se empareja con el primer evento libre que coincide en usuario, mercado, lado, margen y apalancamiento.
  const opened = parseEventLogs({ abi: exchange.abi, logs: receipt.logs, eventName: "PositionOpened" });
  const closed = parseEventLogs({ abi: exchange.abi, logs: receipt.logs, eventName: "PositionClosed" });
  const used = new Set<number>();

  batch.forEach((q, i) => {
    const failure = failures.get(i);
    if (failure) {
      o.queue.setStatus({ id: q.id, status: "failed", txHash, code: failure.code, message: `failed inside the batch: ${failure.name}` });
      console.log(`[batch] ${q.id} falló dentro del batch: ${failure.name}`);
      return;
    }
    const u = updates.find((x) => x.feedId === o.feedIdOf(q.instrumentId));
    let positionId: bigint | undefined;
    let price = u ? safeWad(u) : 0n;

    if (q.intent.kind === "open") {
      const it = q.intent.intent;
      const k = opened.findIndex(
        (e, j) =>
          !used.has(j) &&
          e.args.user.toLowerCase() === it.user.toLowerCase() &&
          e.args.instrumentId === it.instrumentId &&
          e.args.isLong === it.isLong &&
          e.args.margin === it.margin &&
          e.args.leverage === it.leverage,
      );
      if (k >= 0) {
        used.add(k);
        positionId = opened[k]!.args.positionId;
        price = opened[k]!.args.entryPrice;
      } else console.error(`[batch] ${q.id} ejecutado pero sin PositionOpened que coincida`);
    } else {
      positionId = q.intent.intent.positionId;
      const e = closed.find((x) => x.args.positionId === positionId);
      if (e) price = e.args.exitPrice;
    }

    o.queue.setStatus({
      id: q.id,
      status: "executed",
      txHash,
      positionId: positionId?.toString(),
      price: price.toString(),
      publishTime: u?.publishTime ?? 0,
    });
  });
  console.log(`[batch] minado en el bloque ${receipt.blockNumber} · ${batch.length - failures.size} ok · ${failures.size} fallaron · gas ${receipt.gasUsed}`);
}

/** pythToWad sin tirar: un expo raro no puede dejar intents colgados después de minar. */
function safeWad(u: PriceUpdate) {
  try {
    return pythToWad(u.price, u.expo);
  } catch {
    return 0n;
  }
}

/** Errores que son del relayer (rol, fee, fondos), no de un intent. */
const RELAYER_ERRORS: ReadonlySet<string> = new Set(["NotRelayer", "InsufficientFee", "TargetNotAllowed", "RefundFailed"]);

function revertName(data: Hex | undefined, error: { message?: string } | undefined) {
  if (data && data !== "0x") {
    try {
      return decodeErrorResult({ abi: [...ERROR_ABI, ...executor.abi], data }).errorName;
    } catch {
      return `desconocido (${data.slice(0, 10)})`;
    }
  }
  return error?.message ? safeError(error) : "sin motivo (¿sin gas?)";
}

/** Resumen del error para logs y estados, sin URLs ni claves. Marca los casos que necesitan atención. */
function classify(e: unknown) {
  const text = safeError(e);
  if (/insufficient funds/i.test(text)) return `no ETH to pay for gas (${text})`;
  if (/NotRelayer/.test(text)) return "the wallet is not authorized as relayer in the BatchExecutor";
  return text;
}

// Errores de Pyth que pueden salir de getPriceNoOlderThan (no están en las ABIs del export).
const PYTH_ERRORS = [
  { type: "error", name: "StalePrice", inputs: [] },
  { type: "error", name: "PriceFeedNotFound", inputs: [] },
  { type: "error", name: "InsufficientFee", inputs: [] },
] as const;
const ERROR_ABI = [...exchange.abi, ...oracle.abi, ...PYTH_ERRORS];

/**
 * Fallos que dependen del momento (precio o reloj de la cadena) o de otro intent del batch (sin motivo = se quedó sin gas):
 * vale la pena reintentarlos en el próximo batch. Siempre con el tope de RELAYER_PRICE_WAIT_MS.
 */
const RETRYABLE: ReadonlySet<string> = new Set(["StalePrice", "PriceTooOld", "IntentExpired", "desconocido (0x)"]);
const KNOWN: ReadonlySet<string> = new Set<RejectCode>([
  "InvalidSignature", "NonceAlreadyUsed", "IntentExpired", "TradingIsPaused", "MarketNotListed", "MarketIsRetired",
  "InvalidLeverage", "InvalidSize", "InsufficientBalance", "OiCapExceeded", "PriceTooOld", "PriceUncertain",
  "PriceJump", "PriceLimitExceeded", "PositionNotFound", "NotPositionOwner", "PositionLiquidatable",
]);

/** Error del Exchange o del oráculo que viene en `CallFailed`, mapeado a `RejectCode` cuando hay uno igual. */
function decodeReason(data: Hex): { name: string; code: RejectCode } {
  try {
    const { errorName } = decodeErrorResult({ abi: ERROR_ABI, data });
    return { name: errorName, code: KNOWN.has(errorName) ? (errorName as RejectCode) : "Unknown" };
  } catch {
    return { name: `desconocido (${data.slice(0, 10)})`, code: "Unknown" };
  }
}

function toCall(q: QueuedIntent) {
  const data =
    q.intent.kind === "open"
      ? encodeFunctionData({ ...exchange, functionName: "openPositionBySig", args: [q.intent.intent, q.signature] })
      : encodeFunctionData({ ...exchange, functionName: "closePositionBySig", args: [q.intent.intent, q.signature] });
  return { target: exchange.address, data };
}
