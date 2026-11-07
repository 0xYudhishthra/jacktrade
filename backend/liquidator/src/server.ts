/**
 * Liquidador: arma la lista de posiciones abiertas desde los eventos del Exchange y, con cada precio de Pyth,
 * detecta las que cruzaron su precio de liquidación y las liquida con su propia wallet. Proceso separado del relayer.
 *
 *   NETWORK=fork pnpm liquidator
 *
 * - GET /positions      posiciones abiertas con su precio de liquidación y la distancia al precio actual
 * - GET /liquidatable   las que cruzaron, desde cuándo y a qué precio
 * - GET /health         200 si está sano; 503 si el precio está atrasado, hay eventos sin aplicar o le falta ETH
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createPriceFeed, isEquityFeed, markets, type PriceUpdate } from "@hm/prices";
import { clientIp, createAlertTracker, deployment, rpcTransport, startDeadManPing, getNetwork, installProcessHandlers, pythToWad, RateLimiter, safeError, startup } from "@hm/shared";
import { createPublicClient, formatEther, formatUnits, parseEther } from "viem";

import { liquidatorWallet } from "./account.js";
import { PositionBook } from "./book.js";
import { createExecutor } from "./executor.js";
import { startBlock, syncPositions } from "./events.js";

const port = Number(process.env.LIQUIDATOR_PORT ?? process.env.PORT ?? 8094);
const staleSeconds = Number(process.env.PRICE_STALE_SECONDS ?? 5);
const minEth = parseEther(process.env.LIQUIDATOR_MIN_ETH ?? "0.005");
const net = getNetwork();
const { name: network, client, chain } = net;

// En mainnet los logs van por el RPC público (rangos grandes); en el fork, por el fork mismo.
const logsClient =
  network === "fork"
    ? client
    : createPublicClient({
        chain,
        // Logs por el RPC público (rangos grandes); si falla, por el principal (Alchemy da pocos bloques por consulta,
        // pero el tramo se achica solo).
        transport: rpcTransport(process.env.LOGS_RPC_URL ?? deployment.rpcUrl, [net.rpcUrl], net.timeout),
        pollingInterval: 1000,
      });

const wallet = await startup("liquidador", "wallet", () => liquidatorWallet(net));
const book = new PositionBook();
await startup("liquidador", "config de los mercados", async () => {
  for (const m of markets) {
    const cfg = await client.readContract({ address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi, functionName: "marketConfig", args: [m.id] });
    book.setBuffer(m.id, cfg.liqBufferBps);
  }
});

// ---------------------------------------------------------------- precios y ejecución
const liquidatable = new Map<bigint, { since: number; price: bigint }>();
const lastPrice = new Map<number, bigint>(); // instrumentId → WAD
const retired = new Map<number, bigint>(); // instrumentId → precio congelado
const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
const marketOf = new Map(markets.map((m) => [m.feedId, m.id]));
const feedOf = new Map(markets.map((m) => [m.id, m.feedId]));

// check() se llama con cada precio, de forma asíncrona: para entonces el ejecutor ya existe.
const feed = createPriceFeed({ onUpdate: (u) => check(u), onStatus: (s) => console.log(`[hermes] ${s}`) });
const executor = createExecutor({
  client,
  wallet,
  prices: feed.store,
  feedIdOf: (id) => feedOf.get(id as (typeof markets)[number]["id"]),
  maxIds: Number(process.env.LIQUIDATOR_MAX_IDS ?? 100),
  gasBase: BigInt(process.env.LIQUIDATOR_GAS_BASE ?? 200_000),
  gasPerLiquidation: BigInt(process.env.LIQUIDATOR_GAS_PER_LIQUIDATION ?? 300_000),
  updateGas: BigInt(process.env.LIQUIDATOR_UPDATE_GAS ?? 1_000_000),
  retryAfterMs: Number(process.env.LIQUIDATOR_RETRY_MS ?? 15_000),
  pauseAfterErrorMs: Number(process.env.LIQUIDATOR_PAUSE_AFTER_ERROR_MS ?? 5_000),
  receiptTimeoutMs: Number(process.env.LIQUIDATOR_RECEIPT_TIMEOUT_MS ?? 30_000),
  simulateBudgetMs: Number(process.env.LIQUIDATOR_SIMULATE_BUDGET_MS ?? 300),
  onLiquidated: (ids) => {
    for (const id of ids) {
      book.remove(id);
      liquidatable.delete(id);
    }
  },
  log: (m) => console.log(`[liquidar] ${m}`),
});
console.log(`Wallet del liquidador: ${wallet.account.address}`);

// ---------------------------------------------------------------- eventos
const fromBlock = await startup("liquidador", "bloque inicial", () => startBlock(client, network));
console.log(`Liquidador (${network}) · leyendo eventos desde el bloque ${fromBlock}…`);
const t0 = Date.now();
const sync = syncPositions({
  client,
  logsClient,
  book,
  fromBlock,
  chunk: BigInt(process.env.LOGS_CHUNK ?? 5000),
  confirmations: BigInt(process.env.LIQUIDATOR_CONFIRMATIONS ?? (network === "fork" ? 0 : 2)),
  pollMs: Number(process.env.LIQUIDATOR_POLL_MS ?? 1000),
  onEvent: (e) => console.log(`[eventos] ${e} · abiertas: ${book.size}`),
  onRetired: (instrumentId, frozenPrice) => {
    // El contrato liquida un mercado retirado al precio congelado, no al de Pyth (ver el intervalo de abajo).
    retired.set(instrumentId, frozenPrice);
    void executor.run(book.crossed(instrumentId, frozenPrice), { retired: true });
  },
});
await startup("liquidador", "historia de eventos", () => sync.caughtUp);
console.log(`Historia leída en ${((Date.now() - t0) / 1000).toFixed(1)} s · ${book.size} posiciones abiertas · siguiendo bloques nuevos`);

// Mercados retirados: se reevalúan cada 10 s contra el precio congelado hasta que no quede ninguna cruzada.
// Un solo intento se perdía si el ejecutor estaba ocupado, fallaba o había más de maxIds posiciones.
setInterval(() => {
  for (const [id, frozen] of retired) {
    const crossedList = book.crossed(id, frozen);
    if (crossedList.length > 0) void executor.run(crossedList, { retired: true });
  }
}, 10_000).unref();

function check(u: PriceUpdate) {
  // Un dato raro de un feed no puede cortar el stream para todos los mercados.
  try {
    const instrumentId = marketOf.get(u.feedId);
    if (instrumentId === undefined || retired.has(instrumentId)) return;
    const price = pythToWad(u.price, u.expo);
    lastPrice.set(instrumentId, price);

    const crossedList = book.crossed(instrumentId, price);
    const crossed = new Set(crossedList.map((p) => p.id));
    for (const id of crossed) {
      if (liquidatable.has(id)) continue;
      liquidatable.set(id, { since: Date.now(), price });
      const p = book.get(id)!;
      console.log(`⚡ liquidable ${id}: ${name(instrumentId)} ${p.isLong ? "long" : "short"} ×${p.leverage} · liquidación ${usd(p.liquidationPrice).toFixed(2)} · precio ${usd(price).toFixed(2)}`);
    }
    for (const [id] of liquidatable) {
      const p = book.get(id);
      if (!p) liquidatable.delete(id); // ya no está abierta (cerrada o liquidada)
      else if (p.instrumentId === instrumentId && !crossed.has(id)) {
        liquidatable.delete(id);
        console.log(`  ${id} volvió a estar fuera de liquidación (precio ${usd(price).toFixed(2)})`);
      }
    }
    if (crossedList.length > 0) void executor.run(crossedList);
  } catch (e) {
    console.error(`⚠ [precios] no se pudo procesar el precio de ${u.feedId.slice(0, 10)}: ${safeError(e)}`);
  }
}

// ---------------------------------------------------------------- salud y alertas
const alerts = createAlertTracker("liquidador");
let ethBalance: bigint | undefined;
let head: bigint | undefined; // último bloque de la cadena, para medir el atraso de la lectura de eventos
const maxLagBlocks = BigInt(process.env.LIQUIDATOR_MAX_LAG_BLOCKS ?? 600); // ~1-2 min en esta cadena
const stuckSeconds = Number(process.env.LIQUIDATOR_STUCK_SECONDS ?? 30);
// Conciliación: el OI que suma el libro tiene que coincidir con marketState en la cadena. Si difiere en dos chequeos
// seguidos, el libro perdió eventos (o tiene posiciones fantasma).
let oiMismatch: { markets: string; count: number } | undefined;
async function reconcileOi() {
  const diffs: string[] = [];
  const at = sync.lastBlock(); // el libro tiene aplicados los eventos hasta este bloque: se compara en ese mismo bloque
  for (const m of markets) {
    const [, isRetired, , longOi, shortOi] = await client.readContract({ ...exchange, functionName: "marketState", args: [m.id], blockNumber: at });
    if (isRetired) continue;
    let bookLong = 0n;
    let bookShort = 0n;
    for (const p of book.all()) if (p.instrumentId === m.id) p.isLong ? (bookLong += p.margin * p.leverage) : (bookShort += p.margin * p.leverage);
    if (bookLong !== longOi || bookShort !== shortOi) diffs.push(m.name);
  }
  const key = diffs.join(", ");
  oiMismatch = diffs.length ? { markets: key, count: oiMismatch?.markets === key ? oiMismatch.count + 1 : 1 } : undefined;
}
function health() {
  const now = Date.now() / 1000;
  const problems: string[] = [];
  for (const m of markets) {
    const u = feed.store.latest(m.feedId);
    // Acciones: fuera de horario Pyth no publica; un precio viejo ahí es lo esperado, no una falla.
    if (!u || (now - u.publishTime > staleSeconds && !isEquityFeed(m.feedId))) problems.push(`precio de ${m.name} atrasado`);
  }
  const feedless = book.markets().filter((id) => !feedOf.has(id as (typeof markets)[number]["id"]) && !retired.has(id));
  if (feedless.length) problems.push(`posiciones en mercados sin feed: ${feedless.join(", ")}`);
  if (sync.parked() > 0) problems.push(`${sync.parked()} evento(s) sin aplicar`);
  if (head !== undefined && head - sync.lastBlock() > maxLagBlocks) {
    problems.push(`la lectura de eventos va ${head - sync.lastBlock()} bloques atrás (posiciones nuevas sin vigilar)`);
  }
  if (Date.now() - sync.lastGood() > 120_000) problems.push(`no lee eventos hace ${Math.round((Date.now() - sync.lastGood()) / 1000)} s`);
  if (oiMismatch && oiMismatch.count >= 2) problems.push(`el OI del libro no coincide con la cadena en ${oiMismatch.markets} (faltan o sobran posiciones)`);
  const stuck = [...liquidatable.values()].filter((l) => Date.now() - l.since > stuckSeconds * 1000).length;
  if (stuck > 0) problems.push(`${stuck} posición(es) liquidable(s) hace más de ${stuckSeconds} s sin liquidar`);
  const execError = executor.lastError();
  if (execError && Date.now() - execError.at < 120_000) problems.push(`error al liquidar: ${execError.message}`);
  if (ethBalance !== undefined && ethBalance < minEth) problems.push(`poco ETH en la wallet (${formatEther(ethBalance)})`);
  return { ok: problems.length === 0, problems, network, open: book.size, liquidatable: liquidatable.size, lastBlock: sync.lastBlock(), eth: ethBalance === undefined ? null : formatEther(ethBalance) };
}

// Alertas en el log (el paso 20 las manda a un canal). Cada 10 s, solo si hay problemas.
setInterval(async () => {
  try {
    [ethBalance, head] = await Promise.all([client.getBalance({ address: wallet.account.address }), logsClient.getBlockNumber()]);
    await reconcileOi();
  } catch (e) {
    console.error(`[salud] no se pudo leer el saldo: ${safeError(e)}`);
  }
  const h = health();
  if (!h.ok) console.warn(`⚠ ALERTA [liquidador] ${h.problems.join(" · ")}`);
  void alerts.report(h.problems);
}, 10_000).unref();

// Monitor externo: vivo si lee eventos y tiene precios frescos de algún mercado.
startDeadManPing("liquidador", () => {
  const now = Date.now() / 1000;
  const fresh = markets.some((m) => {
    const u = feed.store.latest(m.feedId);
    return !!u && now - u.publishTime < 60;
  });
  return fresh && Date.now() - sync.lastGood() < 120_000;
});

// ---------------------------------------------------------------- HTTP
const name = (id: number) => markets.find((m) => m.id === id)?.name ?? String(id);
const usd = (wad: bigint) => Number(wad) / 1e18;
const ipLimiter = new RateLimiter(20, 5);

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

function route(req: IncomingMessage, res: ServerResponse) {
  if (!ipLimiter.allow(clientIp(req))) return json(res, 429, { error: "demasiados pedidos" });
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/positions") {
    return json(
      res,
      200,
      book.all().map((p) => ({
        id: p.id,
        user: p.user,
        market: name(p.instrumentId),
        side: p.isLong ? "long" : "short",
        margin: formatUnits(p.margin, 6),
        leverage: p.leverage,
        entry: usd(p.entryPrice),
        liquidation: usd(p.liquidationPrice),
        // Cuánto tiene que moverse el precio (en %) para liquidarla. Negativo: ya cruzó.
        distancePct: lastPrice.has(p.instrumentId)
          ? Number(((Number(lastPrice.get(p.instrumentId)! - p.liquidationPrice) / Number(lastPrice.get(p.instrumentId)!)) * (p.isLong ? 100 : -100)).toFixed(4))
          : null,
      })),
    );
  }
  if (path === "/liquidatable") {
    return json(
      res,
      200,
      [...liquidatable].map(([id, l]) => ({ id, market: name(book.get(id)?.instrumentId ?? -1), since: new Date(l.since).toISOString(), price: usd(l.price) })),
    );
  }
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
server.listen(port, () => console.log(`Liquidador en http://localhost:${port}/positions`));

installProcessHandlers("liquidador", async () => {
  sync.stop();
  await feed.stop();
  server.close();
});
