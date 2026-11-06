/**
 * Keepers: mantenimiento del Exchange con su propia wallet, en un proceso aparte del relayer y del liquidador.
 * - heartbeat: mantiene cerrado el escape hatch cuando el relayer no tuvo actividad (ver tasks.ts).
 * - harvest: paga la fila de ganadores en espera cuando hay caja.
 * - pushStakerFees: manda a staking las fees acumuladas para stakers.
 *
 *   NETWORK=fork pnpm keepers
 *
 * - GET /health   200 si está sano; 503 con la lista de problemas (escape hatch por vencer, sin rol, poco ETH…)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { clientIp, createAlertTracker, getNetwork, startDeadManPing, installProcessHandlers, RateLimiter, safeError, startup } from "@hm/shared";
import { formatEther, formatUnits, parseEther, parseUnits } from "viem";

import { keeperWallet } from "./account.js";
import { heartbeatPlan } from "./decide.js";
import { createKeepers } from "./tasks.js";

const port = Number(process.env.KEEPERS_PORT ?? process.env.PORT ?? 8095);
const checkMs = Number(process.env.KEEPER_CHECK_MS ?? 15_000);
const minEth = parseEther(process.env.KEEPER_MIN_ETH ?? "0.002");
const heartbeatMargin = BigInt(process.env.KEEPER_HEARTBEAT_MARGIN_SECONDS ?? 4 * 3600); // con escapeDelay de 24 h: a las 20 h
const harvestStuckSeconds = Number(process.env.KEEPER_HARVEST_STUCK_SECONDS ?? 300);
// Indexer lag: the web reads positions, history and balances from it, so falling behind looks like lost trades.
const indexerStatusUrl = process.env.INDEXER_STATUS_URL ?? (process.env.RAILWAY_SERVICE__HM_INDEXER_URL ? `https://${process.env.RAILWAY_SERVICE__HM_INDEXER_URL}/status` : undefined);
const indexerMaxLag = Number(process.env.INDEXER_MAX_LAG_BLOCKS ?? 300); // ~30 s on Robinhood Chain
const net = getNetwork();
const { name: network, client } = net;

const wallet = await startup("keepers", "wallet", () => keeperWallet(net));
const keepers = createKeepers({
  client,
  wallet,
  heartbeatMargin,
  heartbeatGas: BigInt(process.env.KEEPER_HEARTBEAT_GAS ?? 150_000),
  harvestMaxEntries: BigInt(process.env.KEEPER_HARVEST_MAX_ENTRIES ?? 50),
  harvestMinPay: parseUnits(process.env.KEEPER_HARVEST_MIN_USDG ?? "1", 6),
  harvestGasBase: BigInt(process.env.KEEPER_HARVEST_GAS_BASE ?? 100_000),
  harvestGasPerEntry: BigInt(process.env.KEEPER_HARVEST_GAS_PER_ENTRY ?? 60_000),
  stakerFeesMin: parseUnits(process.env.KEEPER_STAKER_FEES_MIN_USDG ?? "5", 6),
  stakerFeesEveryMs: Number(process.env.KEEPER_STAKER_FEES_EVERY_HOURS ?? 24) * 3_600_000,
  stakerFeesGas: BigInt(process.env.KEEPER_STAKER_FEES_GAS ?? 250_000),
  receiptTimeoutMs: Number(process.env.KEEPER_RECEIPT_TIMEOUT_MS ?? 30_000),
  relayerLiveUrl: process.env.RELAYER_LIVE_URL,
  log: (m) => console.log(`[keepers] ${m}`),
});
console.log(`Keepers (${network}) · wallet ${wallet.account.address} · chequeo cada ${checkMs / 1000} s`);
if (!process.env.RELAYER_LIVE_URL) console.warn("⚠ sin RELAYER_LIVE_URL: el heartbeat sale aunque el relayer esté caído (los usuarios no podrían salir por el escape hatch)");
await startup("keepers", "primera lectura", () => keepers.tick());

// ---------------------------------------------------------------- salud y alertas
const alerts = createAlertTracker("keepers");
let ethBalance: bigint | undefined;
let indexerLag: { blocks: number; at: number } | { error: string; at: number } | undefined;

async function checkIndexer() {
  if (!indexerStatusUrl) return;
  try {
    const [head, res] = await Promise.all([client.getBlockNumber(), fetch(indexerStatusUrl, { signal: AbortSignal.timeout(5_000) })]);
    const body = (await res.json()) as Record<string, { block?: { number?: number } }>;
    const indexed = Object.values(body)[0]?.block?.number;
    indexerLag = indexed === undefined ? { error: `/status respondió ${res.status} sin bloque`, at: Date.now() } : { blocks: Number(head) - indexed, at: Date.now() };
  } catch (e) {
    indexerLag = { error: safeError(e), at: Date.now() };
  }
}
const hours = (s: bigint) => (Number(s) / 3600).toFixed(1);

function health() {
  const { state, stateAt, lastError, lastHeartbeat, lastHarvest, harvestableSince, lastStakerPush, relayerAlive } = keepers.status();
  const staker = keepers.stakerPlan();
  const problems: string[] = [];
  if (!state || Date.now() - stateAt > Math.max(3 * checkMs, 60_000)) problems.push("no puede leer la cadena");
  let escape;
  if (state) {
    const plan = heartbeatPlan({ now: state.now, lastActivity: state.lastActivity, escapeDelay: state.escapeDelay, margin: heartbeatMargin });
    escape = { opensInHours: Number(hours(plan.remaining)), open: plan.open };
    if (!state.isRelayer) problems.push("la wallet no está en BatchExecutor.isRelayer (no puede mandar heartbeat)");
    if (plan.open) problems.push("escape hatch ABIERTO: se puede cerrar directo eligiendo precio");
    else if (plan.due && relayerAlive === false) problems.push(`el relayer está caído: no mando heartbeat y el escape hatch se abre en ${hours(plan.remaining)} h (los usuarios van a poder cerrar solos)`);
    else if (plan.due) problems.push(`escape hatch vence en ${hours(plan.remaining)} h y el heartbeat no salió`);
  }
  if (harvestableSince && Date.now() - harvestableSince > harvestStuckSeconds * 1000) {
    problems.push(`la fila tiene caja para cobrar hace ${Math.round((Date.now() - harvestableSince) / 60_000)} min y harvest no sale`);
  }
  if (lastError && Date.now() - lastError.at < 5 * 60_000) problems.push(`error reciente: ${lastError.message}`);
  if (ethBalance !== undefined && ethBalance < minEth) problems.push(`poco ETH en la wallet (${formatEther(ethBalance)})`);
  if (indexerLag && "error" in indexerLag) problems.push(`no se puede leer el indexer: ${indexerLag.error}`);
  else if (indexerLag && indexerLag.blocks > indexerMaxLag) problems.push(`el indexer va ${indexerLag.blocks} bloques atrás (~${Math.round(indexerLag.blocks / 10)} s): la web muestra datos viejos`);
  return {
    ok: problems.length === 0,
    problems,
    network,
    wallet: wallet.account.address,
    eth: ethBalance === undefined ? null : formatEther(ethBalance),
    indexerLag: indexerLag ?? null,
    escape,
    queue: state && {
      entries: Number(state.tail - state.head),
      totalQueued: formatUnits(state.totalQueued, 6),
      sideBucket: formatUnits(state.sideBucket, 6),
      lpCash: formatUnits(state.lpCash, 6),
    },
    lastHeartbeat: lastHeartbeat && { at: new Date(lastHeartbeat.at).toISOString(), tx: lastHeartbeat.hash },
    stakerFees: staker && { accrued: formatUnits(staker.accrued, 6), lpExcess: formatUnits(staker.excess, 6), due: staker.due },
    lastStakerPush: lastStakerPush && { at: new Date(lastStakerPush.at).toISOString(), tx: lastStakerPush.hash, fees: formatUnits(lastStakerPush.fees, 6), lpExcess: formatUnits(lastStakerPush.lpExcess, 6) },
    lastHarvest: lastHarvest && { at: new Date(lastHarvest.at).toISOString(), tx: lastHarvest.hash, paid: formatUnits(lastHarvest.paid, 6) },
  };
}

setInterval(() => void keepers.tick(), checkMs).unref();

// Alertas en el log (el paso 20 las manda a un canal). Cada 30 s, solo si hay problemas.
setInterval(async () => {
  try {
    ethBalance = await client.getBalance({ address: wallet.account.address });
  } catch (e) {
    console.error(`[salud] no se pudo leer el saldo: ${safeError(e)}`);
  }
  await checkIndexer();
  const h = health();
  if (!h.ok) console.warn(`⚠ ALERTA [keepers] ${h.problems.join(" · ")}`);
  void alerts.report(h.problems);
}, 30_000).unref();

// Monitor externo: vivo si pudo leer la cadena hace poco.
startDeadManPing("keepers", () => Date.now() - keepers.status().stateAt < Math.max(3 * checkMs, 60_000));

// ---------------------------------------------------------------- HTTP
const ipLimiter = new RateLimiter(20, 5);

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}

function route(req: IncomingMessage, res: ServerResponse) {
  if (!ipLimiter.allow(clientIp(req))) return json(res, 429, { error: "demasiados pedidos" });
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/health") {
    const h = health();
    return json(res, h.ok ? 200 : 503, h);
  }
  json(res, 404, { error: "no existe" });
}

const server = createServer((req, res) => {
  try {
    route(req, res);
  } catch (e) {
    console.error(`[http] ${safeError(e)}`);
    if (!res.headersSent) json(res, 400, { error: "pedido inválido" });
  }
});
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.listen(port, () => console.log(`Keepers en http://localhost:${port}/health`));

installProcessHandlers("keepers", () => {
  server.close();
});
