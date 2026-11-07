/**
 * Relayer: recibe intents firmados, los valida, los junta en batches y los manda al BatchExecutor.
 *
 *   pnpm relayer                 # contra NETWORK del .env
 *   NETWORK=fork pnpm relayer    # contra el fork
 *
 * - POST /intent       SubmitIntentRequest → 202 { id, status: "queued" } · 400/429 { status: "rejected", code, message }
 * - GET  /intent/:id   IntentStatus
 * - GET  /config       lo que el front necesita para firmar: chain, contratos, EIP-712, mercados y hora de la cadena
 * - GET  /health       estado del relayer
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createPriceFeed, isEquityFeed, markets } from "@hm/prices";
import {
  clientIp,
  deployment,
  getNetwork,
  installProcessHandlers,
  intentFromJson,
  RateLimiter,
  recoverIntentSigner,
  safeError,
  startup,
  actionFromJson,
  actionId,
  recoverActionSigner,
  type IntentRejected,
  type SubmitActionRequest,
  type SubmitIntentRequest,
  createAlertTracker,
  startDeadManPing,
} from "@hm/shared";
import { formatEther, formatUnits, parseEther, type Hex } from "viem";

import { relayerWallet } from "./account.js";
import { ActionQueue, sendNextAction, validateAction, type ActionContext } from "./actions.js";
import { startBatcher } from "./batcher.js";
import { ChainState } from "./chain.js";
import { IntentQueue } from "./queue.js";
import { Rejected, validateIntent, type ValidationContext } from "./validate.js";

const port = Number(process.env.RELAYER_PORT ?? process.env.PORT ?? 8091);
const net = getNetwork();
const { name: network, client } = net;
const wallet = await startup("relayer", "wallet", () => relayerWallet(net));

const chain = new ChainState(client, markets.map((m) => m.id));
const sessionKeyMaxDuration = await startup("relayer", "SessionKeyManager.MAX_DURATION", async () =>
  Number(await client.readContract({ address: deployment.contracts.SessionKeyManager.address, abi: deployment.contracts.SessionKeyManager.abi, functionName: "MAX_DURATION" })),
);
await startup("relayer", "estado de la cadena", () => chain.start());
const feed = createPriceFeed({ onStatus: (s) => console.log(`[hermes] ${s}`) });
const queue = new IntentQueue();
const actions = new ActionQueue();
const feedIds = new Map(markets.map((m) => [m.id, m.feedId]));

// En el fork, anvil se congela unos segundos cada vez que baja estado nuevo de Alchemy y su reloj se atrasa
// (pnpm fork lo realinea). Ahí se tolera más: los intents esperan en la fila a que la cadena se ponga al día.
// En mainnet la cadena no se congela y valen los valores estrictos.
const onFork = network === "fork";

const ctx: ValidationContext = {
  chain,
  prices: feed.store,
  feedIdOf: (id) => feedIds.get(id as (typeof markets)[number]["id"]),
  // Lo que está en fila reserva balance y nonces del Exchange: los intents y también los retiros firmados.
  pending: {
    hasNonce: (user, nonce) => queue.hasNonce(user, nonce) || actions.hasExchangeNonce(user, nonce),
    reservedMargin: (user) => queue.reservedMargin(user) + actions.reservedWithdraw(user),
    reservedOi: (id, isLong) => queue.reservedOi(id, isLong),
  },
  maxIntentAge: Number(process.env.RELAYER_MAX_INTENT_AGE ?? 30),
  futureTolerance: Number(process.env.RELAYER_FUTURE_TOLERANCE ?? (onFork ? 15 : 2)),
};

// Tope de gas por transacción de la cadena (Arbitrum/Orbit: 32M). Un batch que pida más falla al enviarse y,
// como vuelve igual a la fila, trabaría todo: el tamaño máximo se ajusta para que entre siempre.
const gasBase = BigInt(process.env.RELAYER_GAS_BASE ?? 300_000);
const gasPerCall = BigInt(process.env.RELAYER_GAS_PER_CALL ?? 800_000);
const maxTxGas = BigInt(process.env.RELAYER_MAX_TX_GAS ?? 30_000_000);
const maxBatchByGas = Number((maxTxGas - gasBase) / gasPerCall);
const maxBatch = Math.min(Number(process.env.RELAYER_MAX_BATCH ?? 50), maxBatchByGas);
if (maxBatch < Number(process.env.RELAYER_MAX_BATCH ?? 50)) console.log(`[batch] máximo ${maxBatch} intents por batch (tope de gas ${maxTxGas})`);

const batcher = startBatcher({
  client,
  wallet,
  chain,
  prices: feed.store,
  queue,
  feedIds: markets.map((m) => m.feedId),
  feedIdOf: ctx.feedIdOf,
  intervalMs: Number(process.env.RELAYER_BATCH_MS ?? 200),
  gasBase,
  gasPerCall,
  maxBatch,
  maxPriceWaitMs: Number(process.env.RELAYER_PRICE_WAIT_MS ?? (onFork ? 20_000 : 5000)),
  receiptTimeoutMs: Number(process.env.RELAYER_RECEIPT_TIMEOUT_MS ?? 30_000),
  afterBatch: () =>
    sendNextAction({
      client,
      wallet,
      queue: actions,
      gas: BigInt(process.env.RELAYER_ACTION_GAS ?? 400_000),
    }),
});

const actionCtx: ActionContext = {
  client,
  chain,
  queue: actions,
  reservedMargin: (user) => queue.reservedMargin(user),
  intentHasNonce: (user, nonce) => queue.hasNonce(user, nonce),
  minDeadlineSeconds: Number(process.env.RELAYER_ACTION_MIN_DEADLINE ?? 60),
  maxPendingPerUser: Number(process.env.RELAYER_ACTION_MAX_PENDING_PER_USER ?? 2),
  maxPending: Number(process.env.RELAYER_ACTION_MAX_PENDING ?? 200),
  dailyQuota: Number(process.env.RELAYER_ACTION_DAILY_QUOTA ?? 20),
  sessionKeyMaxDuration,
};

// Límites. Por IP antes de leer nada (frena a quien rota direcciones) y por firmante después de recuperar la firma
// localmente, sin RPC: así nadie puede gastarle el límite a otro usuario mandando basura con su dirección.
const SECP256K1_HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const ipLimiter = new RateLimiter(Number(process.env.RELAYER_IP_BURST ?? 30), Number(process.env.RELAYER_IP_PER_SECOND ?? 10));
const signerLimiter = new RateLimiter(10, 5);

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
}

// Errores que no son de un intent: { code, message } como el resto de la API (error queda por compatibilidad).
const fail = (res: ServerResponse, status: number, code: string, message: string) => json(res, status, { code, message, error: message });

const rejected = (res: ServerResponse, status: number, code: IntentRejected["code"], message: string) =>
  json(res, status, { status: "rejected", code, message } satisfies IntentRejected);

async function readBody(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new Error("body too large");
  }
  return body;
}

async function submit(req: IncomingMessage, res: ServerResponse) {
  let request: SubmitIntentRequest;
  let intent;
  try {
    request = JSON.parse(await readBody(req)) as SubmitIntentRequest;
    if (typeof request?.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(request.signature)) {
      throw new Error("signature must be a 65-byte hex signature");
    }
    // OpenZeppelin rechaza firmas con s alto (maleables): se rechazan acá para no gastar una simulación.
    if (BigInt(`0x${request.signature.slice(66, 130)}`) > SECP256K1_HALF_N) throw new Error("signature with high s (not canonical)");
    intent = intentFromJson(request);
  } catch (e) {
    return rejected(res, 400, "BadRequest", safeError(e));
  }

  // Recuperar la firma es local (sin RPC). El límite por usuario se cobra al que firmó de verdad.
  let signer: Hex;
  try {
    signer = await recoverIntentSigner(intent, request.signature as Hex);
  } catch {
    return rejected(res, 400, "InvalidSignature", "unreadable signature");
  }
  if (!signerLimiter.allow(signer.toLowerCase())) return rejected(res, 429, "RateLimited", "too many intents in a row");

  try {
    const { instrumentId, walletHasCode } = await validateIntent(intent, request.signature as Hex, ctx, signer);
    const queued = queue.add({ intent, signature: request.signature as Hex, signer, instrumentId, walletHasCode });
    console.log(`[intent] ${queued.id} ${intent.kind} en fila (firmó ${signer === intent.intent.user ? "la wallet" : "session key"})`);
    return json(res, 202, { id: queued.id, status: "queued" });
  } catch (e) {
    if (e instanceof Rejected) {
      console.log(`[intent] rechazado ${intent.kind} de ${intent.intent.user}: ${e.code} · ${e.message}`);
      return rejected(res, 400, e.code, e.message);
    }
    console.error(`[intent] error inesperado: ${safeError(e)}`);
    return rejected(res, 500, "Unknown", "relayer error");
  }
}

async function submitAction(req: IncomingMessage, res: ServerResponse) {
  let request: SubmitActionRequest;
  let action;
  try {
    request = JSON.parse(await readBody(req)) as SubmitActionRequest;
    if (typeof request?.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(request.signature)) {
      throw new Error("signature must be a 65-byte hex signature");
    }
    if (BigInt(`0x${request.signature.slice(66, 130)}`) > SECP256K1_HALF_N) throw new Error("signature with high s (not canonical)");
    action = actionFromJson(request);
  } catch (e) {
    return rejected(res, 400, "BadRequest", safeError(e));
  }
  let signer: Hex;
  try {
    signer = await recoverActionSigner(action, request.signature as Hex);
  } catch {
    return rejected(res, 400, "InvalidSignature", "unreadable signature");
  }
  // Cada acción le cuesta gas al relayer: mismo límite por firmante que los intents.
  if (!signerLimiter.allow(signer.toLowerCase())) return rejected(res, 429, "RateLimited", "too many requests in a row");
  // La misma acción dos veces (doble clic, reintento): la segunda se rechaza antes de validar, así no pisa el estado de la primera.
  const id = actionId(action);
  if (!actions.reserve(id, action.action.user)) return rejected(res, 400, "NonceAlreadyUsed", "this action was already sent (check GET /action/:id)");
  try {
    await validateAction(action, request.signature as Hex, signer, actionCtx);
    const queued = actions.add(action, request.signature as Hex);
    console.log(`[acción] ${queued.id} en fila`);
    return json(res, 202, { id: queued.id, status: "queued" });
  } catch (e) {
    actions.release(id);
    if (e instanceof Rejected) {
      console.log(`[acción] rechazada ${action.kind} de ${action.action.user}: ${e.code} · ${e.message}`);
      return rejected(res, 400, e.code, e.message);
    }
    console.error(`[acción] error inesperado: ${safeError(e)}`);
    return rejected(res, 500, "Unknown", "relayer error");
  }
}

async function route(req: IncomingMessage, res: ServerResponse) {
  if (!ipLimiter.allow(clientIp(req))) return rejected(res, 429, "RateLimited", "too many requests from this IP");
  let path: string;
  try {
    path = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    return fail(res, 400, "BadRequest", "invalid URL");
  }
  if (req.method === "OPTIONS") return json(res, 204, null);
  if (req.method === "POST" && path === "/intent") return submit(req, res);
  if (req.method === "GET" && path.startsWith("/intent/")) {
    let id: string;
    try {
      id = decodeURIComponent(path.slice("/intent/".length)).toLowerCase();
    } catch {
      return fail(res, 400, "BadRequest", "invalid id");
    }
    const status = queue.status(id);
    return status ? json(res, 200, status) : fail(res, 404, "NotFound", "unknown intent");
  }
  if (req.method === "POST" && path === "/action") return submitAction(req, res);
  if (req.method === "GET" && path.startsWith("/action/")) {
    let id: string;
    try {
      id = decodeURIComponent(path.slice("/action/".length)).toLowerCase();
    } catch {
      return fail(res, 400, "BadRequest", "invalid id");
    }
    const status = actions.status(id);
    return status ? json(res, 200, status) : fail(res, 404, "NotFound", "unknown action");
  }
  if (req.method === "GET" && path === "/config") {
    // Así el front no copia direcciones ni tipos a mano. chainTime es para armar signedAt (no usar el reloj del navegador).
    return json(res, 200, {
      chainId: deployment.chainId,
      contracts: {
        Exchange: deployment.contracts.Exchange.address,
        SessionKeyManager: deployment.contracts.SessionKeyManager.address,
        JackTradeStaking: deployment.contracts.JackTradeStaking.address,
      },
      token: deployment.token,
      collateral: deployment.collateral,
      eip712: deployment.eip712.exchange,
      eip712Actions: { sessionKeys: deployment.eip712.sessionKeys, staking: deployment.eip712.staking },
      markets: [...chain.markets].map(([id, m]) => ({
        id,
        name: markets.find((x) => x.id === id)?.name,
        maxLeverage: Number(m.maxLeverage),
        maxConfBps: m.maxConfBps,
        minMargin: m.minMargin.toString(),
        minNotional: m.minNotional.toString(),
        maxNotional: m.maxNotional.toString(),
        listed: m.listed && !m.retired,
      })),
      limits: { intentTtl: chain.intentTtl, maxIntentAge: ctx.maxIntentAge, sessionKeyMaxDuration },
      chainTime: Math.floor(chain.now()),
      tradingPaused: chain.tradingPaused,
    });
  }
  // Vivo de verdad: el loop corre, la wallet tiene rol y ETH. Lo consultan los keepers: si no responde 200, dejan de
  // mandar heartbeat y a las 24 h se abre el escape hatch para que los usuarios puedan cerrar solos.
  if (req.method === "GET" && path === "/live") {
    const reasons: string[] = [];
    if (Date.now() - batcher.lastLoopAt() > 30_000) reasons.push("the batch loop is not running");
    if (watched.isRelayer === false) reasons.push("the wallet is not a relayer");
    if (watched.eth !== undefined && watched.eth === 0n) reasons.push("the wallet has no ETH");
    return json(res, reasons.length ? 503 : 200, { live: reasons.length === 0, reasons });
  }
  if (req.method === "GET" && path === "/health") {
    const h = health();
    return json(res, h.ok ? 200 : 503, h);
  }
  fail(res, 404, "NotFound", "not found");
}

// ---------------------------------------------------------------- salud y alertas
// Cada 10 s: precio, ETH y rol del relayer, escape hatch y caja de la casa. Los problemas van a /health (503) y al log
// como "⚠ ALERTA" (el paso 20 los manda a un canal).
const staleSeconds = Number(process.env.PRICE_STALE_SECONDS ?? 5);
const minEth = parseEther(process.env.RELAYER_MIN_ETH ?? "0.01");
const escapeWarnSeconds = Number(process.env.ESCAPE_WARN_SECONDS ?? 20 * 3600);
const alerts = createAlertTracker("relayer");
const watched: { eth?: bigint; isRelayer?: boolean; lastExecutorActivity?: bigint; escapeDelay?: number; lpBankrollAvailable?: bigint; totalQueued?: bigint } = {};

function health() {
  const now = Date.now() / 1000;
  const problems: string[] = [];
  for (const m of markets) {
    const u = feed.store.latest(m.feedId);
    // Acciones: fuera de horario Pyth no publica y un precio viejo es lo esperado (las órdenes esperan la apertura).
    if (!u || (now - u.publishTime > staleSeconds && !isEquityFeed(m.feedId))) problems.push(`${m.name} price is stale`);
  }
  if (watched.eth !== undefined && watched.eth < minEth) problems.push(`low ETH in the relayer wallet (${formatEther(watched.eth)})`);
  if (watched.isRelayer === false) problems.push("the wallet is not authorized in the BatchExecutor");
  if (watched.lastExecutorActivity !== undefined && watched.escapeDelay) {
    const idle = chain.now() - Number(watched.lastExecutorActivity);
    if (idle > escapeWarnSeconds) problems.push(`${(idle / 3600).toFixed(1)} h without relayer activity: the escape hatch opens at ${watched.escapeDelay / 3600} h (heartbeat missing)`);
  }
  const lastError = batcher.lastError();
  if (lastError && Date.now() - lastError.at < 60_000) problems.push(`last batch failed: ${lastError.message}`);
  return {
    ok: problems.length === 0,
    problems,
    network,
    queued: queue.size,
    chainTime: Math.floor(chain.now()),
    tradingPaused: chain.tradingPaused,
    eth: watched.eth === undefined ? null : formatEther(watched.eth),
    lpBankrollAvailable: watched.lpBankrollAvailable === undefined ? null : formatUnits(watched.lpBankrollAvailable, 6),
    totalQueued: watched.totalQueued === undefined ? null : formatUnits(watched.totalQueued, 6),
  };
}

const exchangeContract = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
setInterval(async () => {
  try {
    const [eth, isRelayer, lastExecutorActivity, limits, lpBankrollAvailable, totalQueued] = await Promise.all([
      client.getBalance({ address: wallet.account.address }),
      client.readContract({ address: deployment.contracts.BatchExecutor.address, abi: deployment.contracts.BatchExecutor.abi, functionName: "isRelayer", args: [wallet.account.address] }),
      client.readContract({ ...exchangeContract, functionName: "lastExecutorActivity" }),
      client.readContract({ ...exchangeContract, functionName: "limits" }),
      client.readContract({ ...exchangeContract, functionName: "lpBankrollAvailable" }),
      client.readContract({ ...exchangeContract, functionName: "totalQueued" }),
    ]);
    // Cambios en la caja de la casa y en la fila: se loguean para seguirlos (no son problemas por sí solos).
    if (watched.lpBankrollAvailable !== undefined && lpBankrollAvailable !== watched.lpBankrollAvailable) {
      console.log(`[casa] caja disponible ${formatUnits(watched.lpBankrollAvailable, 6)} → ${formatUnits(lpBankrollAvailable, 6)} USDG`);
    }
    if (watched.totalQueued !== undefined && totalQueued !== watched.totalQueued) {
      console.log(`[casa] fila ${formatUnits(watched.totalQueued, 6)} → ${formatUnits(totalQueued, 6)} USDG`);
    }
    Object.assign(watched, { eth, isRelayer, lastExecutorActivity, escapeDelay: limits[2], lpBankrollAvailable, totalQueued });
  } catch (e) {
    console.error(`[salud] ${safeError(e)}`);
  }
  const h = health();
  if (!h.ok) console.warn(`⚠ ALERTA [relayer] ${h.problems.join(" · ")}`);
  void alerts.report(h.problems);
}, 10_000).unref();

// Monitor externo: vivo si el loop de batches corre.
startDeadManPing("relayer", () => Date.now() - batcher.lastLoopAt() < 30_000);

// Cualquier error de un pedido termina en 500 para ese pedido; nunca tira el proceso.
const server = createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error(`[http] error en ${req.method} ${req.url?.slice(0, 80)}: ${safeError(e)}`);
    if (!res.headersSent) fail(res, 500, "Unknown", "relayer error");
    else res.end();
  });
});
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;

server.listen(port, () => console.log(`Relayer (${network}) en http://localhost:${port} · wallet ${wallet.account.address}`));

installProcessHandlers("relayer", async () => {
  server.close();
  batcher.stop();
  chain.stop();
  await feed.stop();
});
