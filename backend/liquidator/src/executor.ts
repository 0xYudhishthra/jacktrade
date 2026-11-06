import type { PriceStore } from "@hm/prices";
import { deployment, safeError, type getNetwork } from "@hm/shared";
import { decodeErrorResult, encodeFunctionData, formatTransactionReceipt, keccak256, parseEventLogs, type Account, type Hex, type TransactionReceipt, type WalletClient } from "viem";

import type { TrackedPosition } from "./book.js";

type Client = ReturnType<typeof getNetwork>["client"];

const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
const oracle = { address: deployment.contracts.PriceOracle.address, abi: deployment.contracts.PriceOracle.abi } as const;

export type ExecutorOptions = {
  client: Client;
  wallet: WalletClient & { account: Account };
  prices: PriceStore;
  feedIdOf: (instrumentId: number) => Hex | undefined;
  maxIds: number; // posiciones por transacción
  gasBase: bigint;
  gasPerLiquidation: bigint; // ~130k según el roadmap; se reserva de más
  updateGas: bigint; // gas de updatePrices
  retryAfterMs: number; // enfriamiento de una posición ya enviada o que la simulación no liquida
  pauseAfterErrorMs: number; // pausa después de un error al enviar (corta bucles que gasten ETH)
  receiptTimeoutMs: number;
  simulateBudgetMs: number; // tope de espera de la simulación antes de mandar igual
  onLiquidated: (ids: bigint[]) => void; // para sacarlas de la lista sin esperar a que lleguen los eventos
  log: (msg: string) => void;
};

/**
 * Manda `liquidate(ids)`. `liquidate` es pública (no hace falta ser relayer) pero usa el precio guardado en la cadena,
 * así que primero va `oracle.updatePrices` con el último precio de Pyth. Se simulan las dos juntas (eth_simulateV1)
 * para mandar solo las que de verdad se liquidan, y después se mandan seguidas desde la misma wallet.
 * En un mercado retirado el contrato usa el precio congelado: va solo `liquidate`, sin update.
 * Una corrida por vez.
 */
export function createExecutor(o: ExecutorOptions) {
  const cooldown = new Map<bigint, number>(); // id → hasta cuándo no se vuelve a intentar
  let running = false;
  let pausedUntil = 0;
  let lastError: { at: number; message: string } | undefined; // para /health y las alertas

  async function run(candidates: TrackedPosition[], { retired = false } = {}) {
    const now = Date.now();
    if (running || now < pausedUntil) return;
    const ids = candidates.filter((p) => (cooldown.get(p.id) ?? 0) <= now).slice(0, o.maxIds);
    if (ids.length === 0) return;
    running = true;
    try {
      await liquidate(ids, retired);
    } catch (e) {
      pausedUntil = Date.now() + o.pauseAfterErrorMs;
      lastError = { at: Date.now(), message: safeError(e) };
      o.log(`error: ${lastError.message} · pausa de ${o.pauseAfterErrorMs} ms`);
    } finally {
      running = false;
    }
  }

  const coolDown = (ids: bigint[]) => {
    const until = Date.now() + o.retryAfterMs;
    for (const id of ids) cooldown.set(id, until);
  };

  async function liquidate(positions: TrackedPosition[], retired: boolean) {
    const ids = positions.map((p) => p.id);
    const liquidateCall = (list: bigint[]) => ({
      to: exchange.address,
      data: encodeFunctionData({ abi: exchange.abi, functionName: "liquidate", args: [list] }),
      gas: o.gasBase + o.gasPerLiquidation * BigInt(list.length),
    });

    // Tiempos de cada paso en el log: una liquidación tarde a 500× es deuda para la casa.
    const tStart = Date.now();
    const steps: string[] = [];
    const mark = (label: string, since: number) => steps.push(`${label} ${Date.now() - since} ms`);

    let updateCall: { to: Hex; data: Hex; value: bigint; gas: bigint } | undefined;
    // Nonce y fees en paralelo con la tarifa de Pyth: las dos transacciones se firman acá con nonces seguidos.
    const pre = Date.now();
    const noncePromise = o.client.getTransactionCount({ address: o.wallet.account.address, blockTag: "pending" });
    const feesPromise = o.client.estimateFeesPerGas();
    // Si la corrida termina antes de usarlos (sin precio, nada para liquidar), que un error no quede sin manejar.
    noncePromise.catch(() => {});
    feesPromise.catch(() => {});
    if (!retired) {
      const feedIds = [...new Set(positions.map((p) => o.feedIdOf(p.instrumentId)))];
      if (feedIds.some((id) => !id)) throw new Error("hay posiciones de un mercado sin feed de precio");
      const update = o.prices.getUpdateAfter(feedIds as Hex[], 0);
      if (!update) return;
      const fee = await o.client.readContract({ ...oracle, functionName: "getUpdateFee", args: [update.updateData] });
      updateCall = {
        to: oracle.address,
        data: encodeFunctionData({ abi: oracle.abi, functionName: "updatePrices", args: [update.updateData] }),
        value: fee,
        gas: o.updateGas,
      };
    }

    // Simular con los mismos límites de gas que se van a mandar: cuáles se liquidan de verdad con este precio
    // (el contrato saltea las que no cruzaron, sin revertir).
    mark("tarifa", pre);
    // La simulación evita gastar gas en las que al final no cruzan (el contrato las saltea sin revertir), pero no
    // puede demorar la liquidación: si no contesta en simulateBudgetMs se manda con todas las candidatas.
    const tSim = Date.now();
    const calls = [...(updateCall ? [updateCall] : []), liquidateCall(ids)].map((c) => ({ account: o.wallet.account, ...c }));
    const simulation = o.client.simulateBlocks({ blocks: [{ calls }] }).then(([b]) => b);
    simulation.catch(() => {}); // si contesta tarde con error, ya no importa
    const simulated = await Promise.race([
      simulation,
      new Promise<undefined>((r) => setTimeout(() => r(undefined), o.simulateBudgetMs)),
    ]).catch((e: Error) => { throw new Error(`la simulación falló: ${e.message.split("\n")[0]}`); });
    mark(simulated ? "simulación" : "simulación (sin esperar)", tSim);
    let willLiquidate = ids;
    if (simulated) {
      for (const [i, call] of simulated.calls.entries()) {
        if (call.status !== "success") {
          // StalePrice: el precio de Pyth quedó fuera del maxAge para la cadena (en el fork, por un congelamiento).
          throw new Error(`la simulación de ${i === 0 && updateCall ? "updatePrices" : "liquidate"} revirtió: ${errorName(call.data)}`);
        }
      }
      const sim = simulated.calls.at(-1)!;
      willLiquidate = parseEventLogs({ abi: exchange.abi, logs: sim.logs ?? [], eventName: "PositionLiquidated" }).map((l) => l.args.positionId);
      if (willLiquidate.length === 0) {
        // Con el precio de la cadena no cruzan: enfriamiento, así no se re-simulan en cada precio ni tapan a las reales.
        coolDown(ids);
        o.log(`${ids.length} posición(es) no se liquidan con el precio de la cadena (el precio volvió o se actualizó)`);
        return;
      }
    }

    // Marcar ANTES de mandar: si la segunda transacción falla después de que salió la primera, no se repite
    // un updatePrices pagado en cada precio.
    coolDown(willLiquidate);
    const t0 = Date.now();
    const [nonce, fees] = await Promise.all([noncePromise, feesPromise]);
    const sign = (call: { to: Hex; data: Hex; value?: bigint; gas: bigint }, n: number) =>
      o.wallet.signTransaction({
        account: o.wallet.account,
        chain: o.wallet.chain,
        type: "eip1559",
        ...call,
        nonce: n,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      } as never);
    const txs = await Promise.all([
      ...(updateCall ? [sign(updateCall, nonce)] : []),
      sign(liquidateCall(willLiquidate), nonce + (updateCall ? 1 : 0)),
    ]);
    mark("firma", t0);
    const tSend = Date.now();
    // El update va primero (sin esperar), la liquidación por la vía rápida: el nodo responde con el recibo.
    if (txs.length === 2) await o.client.sendRawTransaction({ serializedTransaction: txs[0]! });
    const serialized = txs.at(-1)!;
    const hash = keccak256(serialized);
    o.log(`mandado liquidate(${willLiquidate.length} posiciones${retired ? ", mercado retirado" : ""}) · tx ${hash}`);
    const receipt = await sendSync(serialized, hash);
    mark("envío+recibo", tSend);
    o.log(`tiempos: ${steps.join(" · ")} · total ${Date.now() - tStart} ms`);
    if (receipt.status !== "success") {
      lastError = { at: Date.now(), message: `liquidate revirtió en la cadena` };
      o.log(`⚠ ALERTA liquidate revirtió (tx ${hash})`);
      return;
    }
    const done = parseEventLogs({ abi: exchange.abi, logs: receipt.logs, eventName: "PositionLiquidated" });
    o.log(`✔ liquidadas ${done.length} en el bloque ${receipt.blockNumber} · ${Date.now() - t0} ms · gas ${receipt.gasUsed}`);
    for (const l of done) cooldown.delete(l.args.positionId);
    o.onLiquidated(done.map((l) => l.args.positionId));
  }

  /** eth_sendRawTransactionSync (un solo parámetro); si falla, la misma tx firmada por la vía normal y recibo cada 100 ms. */
  async function sendSync(serialized: Hex, hash: Hex): Promise<TransactionReceipt> {
    try {
      const raw = await o.client.request({ method: "eth_sendRawTransactionSync" as never, params: [serialized] as never });
      const receipt = formatTransactionReceipt(raw as never);
      if (receipt.transactionHash === hash) return receipt;
    } catch {
      // se sigue por la vía normal
    }
    await o.client.sendRawTransaction({ serializedTransaction: serialized }).catch((err: Error) => {
      if (!/already known|nonce too low|known transaction/i.test(err.message)) throw err;
    });
    const end = Date.now() + o.receiptTimeoutMs;
    for (;;) {
      const receipt = await o.client.getTransactionReceipt({ hash }).catch(() => undefined);
      if (receipt) return receipt;
      if (Date.now() > end) throw new Error(`sin recibo de ${hash} en ${o.receiptTimeoutMs} ms`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // Limpia enfriamientos viejos para que el mapa no crezca.
  setInterval(() => {
    const now = Date.now();
    for (const [id, until] of cooldown) if (until < now) cooldown.delete(id);
  }, 60_000).unref();

  return { run, lastError: () => lastError };
}

const ERRORS = [
  ...exchange.abi,
  ...oracle.abi,
  { type: "error", name: "StalePrice", inputs: [] },
  { type: "error", name: "PriceFeedNotFound", inputs: [] },
] as const;

function errorName(data: Hex | undefined) {
  if (!data || data === "0x") return "sin motivo (¿sin gas?)";
  try {
    return decodeErrorResult({ abi: ERRORS, data }).errorName;
  } catch {
    return `desconocido (${data.slice(0, 10)})`;
  }
}
