/**
 * API para el front, en el mismo servidor que el indexer. Formato en docs/api-front.md.
 * - Lo histórico (posiciones, historial, fila, totales) sale de las tablas del indexer.
 * - Lo que cambia con cada bloque y no se indexa (balance libre, caja de la casa, config de mercados) se lee de la cadena.
 * - El precio actual sale de Pyth (Hermes) en memoria, igual que en el relayer.
 * Montos en USDG y precios como texto decimal; direcciones en minúscula; tiempos en segundos unix.
 *
 * También /health, /ready, /status de Ponder. /graphql y /sql/* solo en el fork o con EXPOSE_SQL=1.
 */
import { readFileSync } from "node:fs";

import { createPriceFeed, markets as feeds } from "@hm/prices";
import { clientIp, createAlertTracker, deployment, getNetwork, startDeadManPing, isLiquidatable, liquidationPrice, payout, pythToWad, RateLimiter, safeError, settle } from "@hm/shared";
import { db } from "ponder:api";
import schema, { market, position, protocol, queueEntry, stake, trader, transfer } from "ponder:schema";
import { Hono, type Context } from "hono";
import { and, client, count, desc, eq, gte, graphql, gt, lt, min, or, sum } from "ponder";
import { formatUnits, getAddress, isAddress, type Hex } from "viem";

import { feedRoutes } from "./feeds.js";
import { leaderboardRoutes } from "./leaderboard.js";
import { profileRoutes } from "../profiles/routes.js";
import { openProfileStore } from "../profiles/store.js";

const { client: chain } = getNetwork();
const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
const tokenomics = { address: deployment.contracts.JackTradeTokenomics.address, abi: deployment.contracts.JackTradeTokenomics.abi } as const;
const token = { address: deployment.contracts.JackTradeToken.address, abi: deployment.contracts.JackTradeToken.abi } as const;
const staking = { address: deployment.contracts.JackTradeStaking.address, abi: deployment.contracts.JackTradeStaking.abi } as const;
const prices = createPriceFeed({ onStatus: (s) => console.log(`[api] hermes: ${s}`) });

const usd = (v: bigint) => formatUnits(v, 6);
const px = (v: bigint) => formatUnits(v, 18);
const nameOf = (id: number) => feeds.find((m) => m.id === id)?.name ?? String(id);
const PAGE = 50;

// ---------------------------------------------------------------- lecturas de la cadena (con caché corta)

function cached<T>(ms: number, fn: () => Promise<T>) {
  let value: { at: number; v: Promise<T> } | undefined;
  return () => {
    if (!value || Date.now() - value.at > ms) {
      value = { at: Date.now(), v: fn() };
      value.v.catch(() => (value = undefined)); // un error no queda guardado
    }
    return value.v;
  };
}

// Config: cambia muy de vez en cuando (la cambia el owner).
const config = cached(30_000, async () => {
  const [limits, fees, cfgs, risks] = await Promise.all([
    chain.readContract({ ...exchange, functionName: "limits" }),
    chain.readContract({ ...exchange, functionName: "fees" }),
    Promise.all(feeds.map((m) => chain.readContract({ ...exchange, functionName: "marketConfig", args: [m.id] }))),
    Promise.all(feeds.map((m) => chain.readContract({ ...exchange, functionName: "marketRisk", args: [m.id] }))),
  ]);
  return {
    limits,
    deadbandDivisor: BigInt(limits[0]),
    fees: { winFeeBps: fees[0], lossFeeBps: fees[1], liqFeeBps: fees[2] },
    market: new Map<number, { cfg: (typeof cfgs)[number]; risk: (typeof risks)[number] }>(feeds.map((m, i) => [m.id, { cfg: cfgs[i]!, risk: risks[i]! }])),
  };
});

// Caja y fila: cambian con cada cierre. 1 s alcanza para que muchas pantallas no multipliquen las lecturas.
const house = cached(1_000, async () => {
  const [lpCash, bankroll, head, tail, trackedLp, paused] = await Promise.all([
    chain.readContract({ ...exchange, functionName: "lpCash" }),
    chain.readContract({ ...exchange, functionName: "lpBankrollAvailable" }),
    chain.readContract({ ...exchange, functionName: "queueHead" }),
    chain.readContract({ ...exchange, functionName: "queueTail" }),
    chain.readContract({ ...exchange, functionName: "trackedLp" }),
    chain.readContract({ ...exchange, functionName: "tradingPaused" }),
  ]);
  return { lpCash, bankroll, queueEmpty: head === tail, trackedLp, paused };
});

const PRICE_MAX_AGE = Number(process.env.API_PRICE_MAX_AGE_SECONDS ?? 60);

/** Último precio de Pyth (WAD). Si es más viejo que PRICE_MAX_AGE (Hermes caído), no se muestra como actual. */
function markPrice(instrumentId: number): bigint | undefined {
  const feed = feeds.find((m) => m.id === instrumentId);
  const u = feed && prices.store.latest(feed.feedId);
  return u && Date.now() / 1000 - u.publishTime <= PRICE_MAX_AGE ? pythToWad(u.price, u.expo) : undefined;
}

// settle es un eth_call por posición: se guarda 2 s por (posición, precio) para que muchas pantallas no lo multipliquen.
const settleCache = new Map<string, { at: number; v: Promise<{ gain: bigint; loss: bigint }> }>();
setInterval(() => {
  for (const [k, e] of settleCache) if (Date.now() - e.at > 2_000) settleCache.delete(k);
}, 10_000).unref();
const MAX_PREVIEWS = 50; // por pedido de /api/positions

type Row = typeof position.$inferSelect;

/**
 * Lo que cobraría si cierra ahora. Usa el precio con el que cerraría el contrato: en un mercado retirado, el congelado;
 * si no, el último de Pyth (el real es el que se empuje en el cierre). Si la posición ya cruzó su precio de liquidación,
 * el cierre revierte en la cadena: se marca `liquidatable` y el resultado es perder el margen.
 */
async function preview(p: Row) {
  const m = await db.query.market.findFirst({ where: eq(market.id, p.instrumentId) });
  const price = m?.retired && m.frozenPrice ? m.frozenPrice : markPrice(p.instrumentId);
  if (price === undefined) return undefined;
  const [cfg, h] = await Promise.all([config(), house()]);
  const mc = cfg.market.get(p.instrumentId);
  if (!mc) return undefined;
  if (isLiquidatable(p, mc.cfg.liqBufferBps, price)) {
    return { price, gain: 0n, loss: p.margin, fee: 0n, payout: 0n, paidNow: 0n, queued: 0n, returned: 0n, pnl: -p.margin, liqBufferBps: mc.cfg.liqBufferBps, liquidatable: true };
  }
  const key = `${p.id}:${price}`;
  let cached = settleCache.get(key);
  if (!cached) {
    cached = {
      at: Date.now(),
      v: settle(chain, { margin: p.margin, leverage: p.leverage, entryPrice: p.entryPrice, exitPrice: price, isLong: p.isLong, deadbandDivisor: cfg.deadbandDivisor, impact: mc.cfg.impact }),
    };
    cached.v.catch(() => settleCache.delete(key));
    settleCache.set(key, cached);
  }
  const { gain, loss } = await cached.v;
  const out = payout({ margin: p.margin, gain, loss, fees: cfg.fees, queueEmpty: h.queueEmpty, lpCash: h.lpCash });
  return { price, gain, loss, ...out, pnl: out.payout - loss, liqBufferBps: mc.cfg.liqBufferBps, liquidatable: false };
}

// ---------------------------------------------------------------- alertas
// El indexer no pasa por installProcessHandlers (lo arranca Ponder): vigila acá lo suyo y avisa por Telegram.
// Atraso del indexado (se mira su propio /status contra la cadena) y precio de Pyth sin actualizar.
const alerts = createAlertTracker("indexer");
const selfUrl = `http://127.0.0.1:${process.env.INDEXER_PORT ?? process.env.PORT ?? 8096}`;
const maxLagBlocks = BigInt(process.env.INDEXER_MAX_LAG_BLOCKS ?? 600);
setInterval(async () => {
  const problems: string[] = [];
  try {
    const [head, ready, status] = await Promise.all([
      chain.getBlockNumber(),
      fetch(`${selfUrl}/ready`).then((r) => r.ok),
      fetch(`${selfUrl}/status`).then((r) => r.json() as Promise<Record<string, { block?: { number: number } }>>),
    ]);
    const indexed = BigInt(Object.values(status)[0]?.block?.number ?? 0);
    if (ready && head - indexed > maxLagBlocks) problems.push(`el indexado va ${head - indexed} bloques atrás`);
  } catch (e) {
    problems.push(`no puede medir su estado: ${safeError(e)}`);
  }
  for (const f of feeds) if (markPrice(f.id) === undefined) problems.push(`sin precio de ${f.name}`);
  void alerts.report(problems);
}, 30_000).unref();

// Monitor externo: vivo si está listo y al día (mismo chequeo que las alertas).
let indexerOk = false;
setInterval(async () => {
  try {
    const [head, ready, status] = await Promise.all([
      chain.getBlockNumber(),
      fetch(`${selfUrl}/ready`).then((r) => r.ok),
      fetch(`${selfUrl}/status`).then((r) => r.json() as Promise<Record<string, { block?: { number: number } }>>),
    ]);
    indexerOk = ready && head - BigInt(Object.values(status)[0]?.block?.number ?? 0) <= maxLagBlocks;
  } catch {
    indexerOk = false;
  }
}, 30_000).unref();
startDeadManPing("indexer", () => indexerOk);

// ---------------------------------------------------------------- HTTP

const app = new Hono<{ Bindings: { incoming: Parameters<typeof clientIp>[0] } }>();
const limiter = new RateLimiter(Number(process.env.API_IP_BURST ?? 60), Number(process.env.API_IP_PER_SECOND ?? 20));

app.use("*", async (c, next) => {
  c.header("access-control-allow-origin", "*");
  // Preflight del navegador antes de un POST/PUT con JSON (perfiles): sin esto el front no puede escribir.
  if (c.req.method === "OPTIONS") {
    c.header("access-control-allow-methods", "GET, POST, PUT, OPTIONS");
    c.header("access-control-allow-headers", "content-type");
    c.header("access-control-max-age", "86400");
    return c.body(null, 204);
  }
  if (c.env?.incoming && !limiter.allow(clientIp(c.env.incoming))) return c.json({ code: "RATE_LIMITED", message: "Too many requests. Please slow down." }, 429);
  await next();
});
app.onError((e, c) => {
  console.error(`[api] ${c.req.path}: ${safeError(e)}`);
  return c.json({ code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." }, 500);
});

// SQL y GraphQL de Ponder aceptan consultas arbitrarias (joins pesados, suscripciones en vivo): con eso cualquiera deja
// la API sin servicio. En producción no se exponen; el front usa /api/*. En el fork quedan para las pruebas.
if (process.env.NETWORK === "fork" || process.env.EXPOSE_SQL === "1") {
  app.use("/sql/*", client({ db, schema }));
  app.use("/graphql", graphql({ db, schema }));
}

// Docs page for the front team: the API reference, served as-is (docs.html is the page body; the shell is added here).
const DOCS_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${readFileSync(new URL("./docs.html", import.meta.url), "utf8")}</body></html>`;
app.get("/", (c) => c.redirect("/docs"));
app.get("/docs", (c) => {
  c.header("cache-control", "public, max-age=60");
  return c.html(DOCS_HTML);
});

function userParam(c: Context): Hex | undefined {
  const u = c.req.param("user") ?? "";
  return isAddress(u) ? (getAddress(u).toLowerCase() as Hex) : undefined;
}

app.get("/api/account/:user", async (c) => {
  const user = userParam(c);
  if (!user) return c.json({ code: "INVALID_REQUEST", message: "Invalid wallet address." }, 400);
  const unpaid = gt(queueEntry.remaining, 0n);
  const [balance, t, st, [mine]] = await Promise.all([
    chain.readContract({ ...exchange, functionName: "balances", args: [user] }),
    db.query.trader.findFirst({ where: eq(trader.address, user) }),
    db.query.stake.findFirst({ where: eq(stake.user, user) }),
    db.select({ first: min(queueEntry.index), waiting: sum(queueEntry.remaining) }).from(queueEntry).where(and(unpaid, eq(queueEntry.user, user))),
  ]);
  // Lugar en la fila: la primera entrada del usuario que falta pagar, y cuánto hay que pagar antes. Con agregados en la
  // base (no se trae la fila entera en cada pedido).
  let queue: { waiting: string; position: number; ahead: string } | null = null;
  if (mine?.first !== null && mine?.first !== undefined) {
    const [before] = await db
      .select({ n: count(), ahead: sum(queueEntry.remaining) })
      .from(queueEntry)
      .where(and(unpaid, lt(queueEntry.index, BigInt(mine.first))));
    queue = { waiting: usd(BigInt(mine.waiting ?? 0)), position: Number(before?.n ?? 0) + 1, ahead: usd(BigInt(before?.ahead ?? 0)) };
  }
  return c.json({
    user,
    balance: usd(balance),
    queue,
    stats: {
      trades: t?.trades ?? 0,
      open: t?.open ?? 0,
      wins: t?.wins ?? 0,
      losses: t?.losses ?? 0,
      liquidations: t?.liquidations ?? 0,
      realizedPnl: usd(t?.realizedPnl ?? 0n),
      volume: usd(t?.volume ?? 0n),
      feesPaid: usd(t?.feesPaid ?? 0n),
      minted: formatUnits(t?.minted ?? 0n, 18),
      deposited: usd(t?.deposited ?? 0n),
      withdrawn: usd(t?.withdrawn ?? 0n),
    },
    // JACKTRADE staked (18 decimals) and USDG rewards: claimed and credited to the Exchange balance (what was paid).
    staking: {
      staked: formatUnits(st?.staked ?? 0n, 18),
      claimed: usd(st?.claimed ?? 0n),
      credited: usd(st?.credited ?? 0n),
    },
  });
});

app.get("/api/positions/:user", async (c) => {
  const user = userParam(c);
  if (!user) return c.json({ code: "INVALID_REQUEST", message: "Invalid wallet address." }, 400);
  const rows = await db.select().from(position).where(and(eq(position.user, user), eq(position.status, "open"))).orderBy(desc(position.id));
  const cfg = await config().catch(() => undefined); // sin RPC, las posiciones igual se listan
  const out = await Promise.all(
    rows.map(async (p, i) => {
      // Sin precio o sin RPC: la posición igual se muestra. Más de MAX_PREVIEWS: sin PnL (se pide con /api/preview).
      const pre = i < MAX_PREVIEWS ? await preview(p).catch(() => undefined) : undefined;
      const buffer = cfg?.market.get(p.instrumentId)?.cfg.liqBufferBps;
      return {
        id: p.id.toString(),
        market: nameOf(p.instrumentId),
        instrumentId: p.instrumentId,
        side: p.isLong ? "long" : "short",
        margin: usd(p.margin),
        leverage: Number(p.leverage),
        entryPrice: px(p.entryPrice),
        markPrice: pre ? px(pre.price) : null,
        liquidationPrice: buffer === undefined ? null : px(liquidationPrice(p, buffer)),
        liquidatable: pre?.liquidatable ?? null,
        pnl: pre ? usd(pre.pnl) : null,
        openedAt: Number(p.openedAt),
      };
    }),
  );
  return c.json(out);
});

app.get("/api/preview/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^\d{1,20}$/.test(id)) return c.json({ code: "INVALID_REQUEST", message: "Invalid position id." }, 400);
  const p = await db.query.position.findFirst({ where: eq(position.id, BigInt(id)) });
  if (!p) return c.json({ code: "NOT_FOUND", message: "Position not found." }, 404);
  if (p.status !== "open") return c.json({ code: "POSITION_NOT_OPEN", message: `The position is already ${p.status}.` }, 409);
  const pre = await preview(p);
  if (!pre) return c.json({ code: "NO_PRICE", message: "No current Pyth price for this market." }, 503);
  return c.json({
    id,
    price: px(pre.price),
    gain: usd(pre.gain),
    loss: usd(pre.loss),
    fee: usd(pre.fee),
    payout: usd(pre.payout),
    pnl: usd(pre.pnl),
    paidNow: usd(pre.paidNow),
    queued: usd(pre.queued),
    returned: usd(pre.returned),
    liquidatable: pre.liquidatable,
  });
});

app.get("/api/history/:user", async (c) => {
  const user = userParam(c);
  if (!user) return c.json({ code: "INVALID_REQUEST", message: "Invalid wallet address." }, 400);
  // Cursor: el historial sigue con lo anterior a ese segundo (exclusivo). Se piden PAGE de cada tabla y se mezclan por fecha.
  const cursor = c.req.query("cursor");
  if (cursor !== undefined && !/^\d{1,12}$/.test(cursor)) return c.json({ code: "INVALID_REQUEST", message: "Invalid cursor." }, 400);
  const before = cursor ? BigInt(cursor) : 2n ** 62n;
  const closedWhere = (extra: ReturnType<typeof lt>) => and(eq(position.user, user), or(eq(position.status, "closed"), eq(position.status, "liquidated")), extra);
  const [closed, moves] = await Promise.all([
    db.select().from(position).where(closedWhere(lt(position.closedAt, before))).orderBy(desc(position.closedAt), desc(position.id)).limit(PAGE),
    db.select().from(transfer).where(and(eq(transfer.user, user), lt(transfer.timestamp, before))).orderBy(desc(transfer.timestamp)).limit(PAGE),
  ]);
  const merged = [...closed.map(closeItem), ...moves.map(moveItem)].sort((a, b) => b.at - a.at).slice(0, PAGE);
  const full = closed.length === PAGE || moves.length === PAGE;
  const last = merged.at(-1)?.at;
  if (!full || last === undefined) return c.json({ items: merged, next: null });
  // Puede haber más con el mismo segundo que el último: se traen todos los de ese segundo (una liquidación en lote puede
  // dejar decenas en el mismo bloque) y la próxima página empieza antes. Así no se pierden, no se repiten ni queda en loop.
  const lastAt = BigInt(last);
  const [closedSame, movesSame] = await Promise.all([
    db.select().from(position).where(closedWhere(eq(position.closedAt, lastAt))).orderBy(desc(position.id)).limit(1000),
    db.select().from(transfer).where(and(eq(transfer.user, user), eq(transfer.timestamp, lastAt))).limit(1000),
  ]);
  const items = [...merged.filter((i) => i.at > last), ...closedSame.map(closeItem), ...movesSame.map(moveItem)];
  return c.json({ items, next: String(last) });
});

function closeItem(p: Row) {
  return {
    type: p.status === "liquidated" ? "liquidation" : "close",
    id: p.id.toString(),
    market: nameOf(p.instrumentId),
    side: p.isLong ? "long" : "short",
    margin: usd(p.margin),
    leverage: Number(p.leverage),
    entryPrice: px(p.entryPrice),
    exitPrice: px(p.exitPrice!),
    pnl: usd(p.pnl!),
    fee: usd(p.fee!),
    openedAt: Number(p.openedAt),
    at: Number(p.closedAt!),
    tx: p.closeTx,
  };
}

function moveItem(t: typeof transfer.$inferSelect) {
  return {
    type: t.kind,
    amount: usd(t.amount),
    ...(t.activationFee ? { activationFee: usd(t.activationFee) } : {}),
    ...(t.to ? { to: t.to } : {}),
    at: Number(t.timestamp),
    tx: t.tx,
  };
}

app.get("/api/markets", async (c) => {
  const dayAgo = BigInt(Math.floor(Date.now() / 1000) - 86_400);
  const [rows, cfg, day] = await Promise.all([
    db.select().from(market),
    config(),
    db
      .select({ id: position.instrumentId, volume: sum(position.notional), trades: count() })
      .from(position)
      .where(gte(position.openedAt, dayAgo))
      .groupBy(position.instrumentId),
  ]);
  return c.json(
    feeds.map((f) => {
      const m = rows.find((r) => r.id === f.id);
      const onchain = cfg.market.get(f.id);
      const price = markPrice(f.id);
      return {
        instrumentId: f.id,
        name: f.name,
        price: price === undefined ? null : px(price),
        listed: m?.listed ?? false,
        retired: m?.retired ?? false,
        frozenPrice: m?.frozenPrice ? px(m.frozenPrice) : null,
        longOi: usd(m?.longOi ?? 0n),
        shortOi: usd(m?.shortOi ?? 0n),
        longOiCap: onchain ? usd(onchain.risk[2]) : null,
        shortOiCap: onchain ? usd(onchain.risk[3]) : null,
        minMargin: onchain ? usd(onchain.risk[0]) : null,
        minNotional: onchain ? usd(onchain.risk[1]) : null,
        maxNotional: onchain ? usd(onchain.cfg.maxNotional) : null,
        maxLeverage: onchain?.cfg.maxLeverage ?? null,
        liqBufferBps: onchain?.cfg.liqBufferBps ?? null,
        maxConfBps: onchain?.cfg.maxConfBps ?? null,
        volume: usd(m?.volume ?? 0n),
        volume24h: usd(BigInt(day.find((d) => d.id === f.id)?.volume ?? 0)),
        trades24h: Number(day.find((d) => d.id === f.id)?.trades ?? 0),
        trades: m?.trades ?? 0,
        open: m?.open ?? 0,
        liquidations: m?.liquidations ?? 0,
      };
    }),
  );
});

app.get("/api/stats", async (c) => {
  const [p, h, [queued]] = await Promise.all([
    db.query.protocol.findFirst({ where: eq(protocol.id, 1) }),
    house(),
    db.select({ n: count() }).from(queueEntry).where(gt(queueEntry.remaining, 0n)),
  ]);
  return c.json({
    trades: p?.trades ?? 0,
    open: p?.open ?? 0,
    volume: usd(p?.volume ?? 0n),
    fees: usd(p?.fees ?? 0n),
    housePnl: usd(-(p?.traderPnl ?? 0n)), // lo que ganó la casa con los trades cerrados
    deposits: usd(p?.deposits ?? 0n),
    withdrawals: usd(p?.withdrawals ?? 0n),
    queue: { total: usd(p?.totalQueued ?? 0n), entries: Number(queued?.n ?? 0) },
    bankroll: usd(h.bankroll),
    paused: h.paused,
    lastHeartbeat: p?.lastHeartbeat ? Number(p.lastHeartbeat) : null,
  });
});

app.get("/api/leaderboard", async (c) => {
  const by = c.req.query("by") ?? "pnl";
  if (by !== "pnl" && by !== "volume") return c.json({ code: "INVALID_REQUEST", message: "by must be pnl or volume." }, 400);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? PAGE) || PAGE, 1), 100);
  const rows = await db
    .select()
    .from(trader)
    .where(gt(trader.trades, 0))
    .orderBy(by === "pnl" ? desc(trader.realizedPnl) : desc(trader.volume))
    .limit(limit);
  // Username si la wallet eligió uno (perfiles); si falla la base de perfiles, el ranking sale igual sin nombres.
  const names = await profiles.usernames(rows.map((t) => t.address)).catch(() => new Map<string, string>());
  return c.json(
    rows.map((t, i) => ({ rank: i + 1, user: t.address, username: names.get(t.address) ?? null, realizedPnl: usd(t.realizedPnl), volume: usd(t.volume), trades: t.trades, wins: t.wins })),
  );
});

// Fees and limits the front needs to show a trade before signing it (they change only when the owner changes them).
app.get("/api/config", async (c) => {
  const cfg = await config();
  const [, intentTtl, escapeDelay, , minDeposit, minWithdraw, activationFee] = cfg.limits;
  return c.json({
    chainId: deployment.chainId,
    fees: cfg.fees, // bps: winFeeBps on profits, lossFeeBps on losses, liqFeeBps on liquidations
    limits: { intentTtl, escapeDelay, minDeposit: usd(minDeposit), minWithdraw: usd(minWithdraw), activationFee: usd(activationFee), deadbandDivisor: Number(cfg.deadbandDivisor) },
    markets: feeds.map((f) => {
      const m = cfg.market.get(f.id);
      return {
        instrumentId: f.id,
        name: f.name,
        maxLeverage: m?.cfg.maxLeverage ?? null,
        liqBufferBps: m?.cfg.liqBufferBps ?? null,
        maxConfBps: m?.cfg.maxConfBps ?? null,
        minMargin: m ? usd(m.risk[0]) : null,
        minNotional: m ? usd(m.risk[1]) : null,
        maxNotional: m ? usd(m.cfg.maxNotional) : null,
        longOiCap: m ? usd(m.risk[2]) : null,
        shortOiCap: m ? usd(m.risk[3]) : null,
        impact: m
          ? {
              baseRate: formatUnits(m.cfg.impact.baseRate, 18),
              rateMultiplier: formatUnits(m.cfg.impact.rateMultiplier, 18),
              positionMultiplier: formatUnits(m.cfg.impact.positionMultiplier, 18),
              referenceNotional: formatUnits(m.cfg.impact.referenceNotional, 18),
            }
          : null,
      };
    }),
  });
});

app.get("/api/rate", async (c) => {
  const { trackedLp } = await house();
  const rate = await chain.readContract({ ...tokenomics, functionName: "currentRate", args: [trackedLp] });
  return c.json({ rate: formatUnits(rate, 18), trackedLp: usd(trackedLp) });
});

// ---------------------------------------------------------------- perfiles (off-chain, escribibles)
// Username por wallet, con firma de la wallet (EOA, ERC-1271 o EIP-7702). Schema propio en el mismo Postgres, fuera de
// las tablas de Ponder (que se rearman con cada deploy). Sin DATABASE_URL, una base embebida en .ponder/.
const network = process.env.NETWORK ?? "mainnet";
const profiles = await openProfileStore({ localDir: `.ponder/profiles-${network}` });
profileRoutes(app, {
  store: profiles,
  client: chain,
  chainId: deployment.chainId,
  challengeTtlSeconds: Number(process.env.PROFILE_CHALLENGE_TTL_SECONDS ?? 600),
  changeCooldownSeconds: Number(process.env.PROFILE_CHANGE_COOLDOWN_HOURS ?? 24) * 3600,
  limits: {
    ipBurst: Number(process.env.PROFILE_IP_BURST ?? 10),
    ipPerSecond: Number(process.env.PROFILE_IP_PER_SECOND ?? 0.2),
    walletBurst: Number(process.env.PROFILE_WALLET_BURST ?? 5),
    walletPerSecond: Number(process.env.PROFILE_WALLET_PER_SECOND ?? 0.05),
  },
});

// Leaderboard v2 (positions and accounts by window). The old /api/leaderboard above stays for the current front.
leaderboardRoutes(app, {
  markPrice: (id) => markPrice(id),
  marketName: nameOf,
  usernames: (wallets) => profiles.usernames(wallets),
  minTrades: Number(process.env.LEADERBOARD_MIN_TRADES ?? 1),
});

// Feeds and charts (activity, PnL, volume, house exposure, history, token).
const tokenData = cached(5_000, async () => {
  const { trackedLp } = await house();
  const [totalSupply, transfersEnabled, totalStaked, rate] = await Promise.all([
    chain.readContract({ ...token, functionName: "totalSupply" }),
    chain.readContract({ ...token, functionName: "transfersEnabled" }),
    chain.readContract({ ...staking, functionName: "totalStaked" }),
    chain.readContract({ ...tokenomics, functionName: "currentRate", args: [trackedLp] }),
  ]);
  return { totalSupply, transfersEnabled, totalStaked, rate };
});
feedRoutes(app, {
  markPrice: (id) => markPrice(id),
  marketName: nameOf,
  marketIds: feeds.map((f) => f.id),
  usernames: (wallets) => profiles.usernames(wallets),
  marketLimits: async () => {
    const cfg = await config();
    return new Map([...cfg.market].map(([id, m]) => [id, { longOiCap: m.risk[2], shortOiCap: m.risk[3], liqBufferBps: m.cfg.liqBufferBps }]));
  },
  house,
  token: tokenData,
  tokenAddress: token.address,
});

export default app;
