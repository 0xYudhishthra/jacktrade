import { db } from "ponder:api";
import { activity, marketPoint, position, protocol, protocolPoint, queueEntry, stake, trader, transfer } from "ponder:schema";
import type { Hono } from "hono";
import { and, count, desc, eq, gt, gte, inArray, isNotNull, lt, or, sql, sum } from "ponder";
import { formatUnits, getAddress, isAddress, type Hex } from "viem";

import { exposure, fillBuckets, INTERVALS, MAX_BUCKETS, parseSeries, strict, sumBuckets } from "../feeds/rules.js";
import { WINDOWS, type Window } from "../leaderboard/rules.js";

/**
 * Data for the front's charts and feeds (everything the UI used to mock). All messages in English.
 *   GET /api/activity                  global feed (trades tape, liquidations, deposits, staking…), or one wallet's
 *   GET /api/pnl/:user                 realized PnL and equity over time for one wallet
 *   GET /api/volume                    opened notional per candle, to draw volume bars under the price chart
 *   GET /api/house                     the house's exposure now: OI, leverage mix, liquidation map, price shocks
 *   GET /api/stats/history             protocol totals over time (house PnL, queue, fees, OI)
 *   GET /api/token                     JACKTRADE supply, staking and rewards
 *   GET /api/token/history             rewards distributed, tokens minted and total staked over time
 */
export type FeedOptions = {
  markPrice: (instrumentId: number) => bigint | undefined;
  marketName: (instrumentId: number) => string;
  marketIds: number[];
  usernames: (wallets: Hex[]) => Promise<Map<string, string>>;
  /** OI caps and liquidation buffer per market, from the chain. */
  marketLimits: () => Promise<Map<number, { longOiCap: bigint; shortOiCap: bigint; liqBufferBps: number }>>;
  house: () => Promise<{ lpCash: bigint; bankroll: bigint; queueEmpty: boolean; trackedLp: bigint; paused: boolean }>;
  token: () => Promise<{ totalSupply: bigint; transfersEnabled: boolean; totalStaked: bigint; rate: bigint }>;
  tokenAddress: Hex;
  cacheMs?: number;
};

const usd = (v: bigint) => formatUnits(v, 6);
const px = (v: bigint) => formatUnits(v, 18);
const tok = (v: bigint) => formatUnits(v, 18);
const now = () => Math.floor(Date.now() / 1000);
// Unix seconds sanity bound (year 2100): keeps grid loops and BigInt conversions small.
const MAX_TIME = 4_102_444_800;
const big = (v: unknown) => BigInt((v as string | number | bigint | null | undefined) ?? 0);

const KINDS = ["open", "close", "liquidation", "deposit", "withdraw", "queued", "queuePaid", "stake", "unstake", "claim", "mint", "distribution"] as const;
type Kind = (typeof KINDS)[number];
// Shortcuts for the usual feeds.
const PRESETS: Record<string, Kind[]> = {
  trades: ["open", "close", "liquidation"],
  transfers: ["deposit", "withdraw"],
  staking: ["stake", "unstake", "claim"],
  queue: ["queued", "queuePaid"],
};
/** Kinds whose amount is JACKTRADE (18 decimals); the rest are USDG. */
const TOKEN_KINDS = new Set<Kind>(["stake", "unstake", "mint"]);

/** Start of the candle that contains a timestamp column. `step` comes from a fixed map, so it goes in as a literal: as a
 * bind parameter, Postgres would not see the GROUP BY / DISTINCT ON expression as the same one as in the SELECT.
 * floor() because Ponder stores bigints as numeric, where division is not integer division. */
const bucketOf = (column: Parameters<typeof sql>[1], step: number) => {
  if (!Number.isInteger(step) || step <= 0) throw new Error("invalid step");
  return sql<string>`floor(${column} / ${sql.raw(String(step))}) * ${sql.raw(String(step))}`;
};

export function feedRoutes(app: Hono<any>, o: FeedOptions) {
  // These routes scan tables: the same URL is answered from memory for a few seconds, and concurrent identical requests
  // share one computation (many viewers cost one query). Registered before the routes so it wraps them.
  const cacheMs = o.cacheMs ?? 3_000;
  const memo = new Map<string, { at: number; v: Promise<{ status: number; body: string }> }>();
  const CACHED = /^\/api\/(activity|pnl\/[^/]+|volume|house|stats\/history|token|token\/history)$/;
  app.use("/api/*", async (c, next) => {
    const url = new URL(c.req.url);
    if (c.req.method !== "GET" || !CACHED.test(url.pathname)) return next();
    const key = url.pathname + url.search;
    let hit = memo.get(key);
    if (!hit || Date.now() - hit.at > cacheMs) {
      const v = (async () => {
        await next();
        return { status: c.res.status, body: await c.res.clone().text() };
      })();
      hit = { at: Date.now(), v };
      memo.set(key, hit);
      v.then((r) => r.status !== 200 && memo.delete(key)).catch(() => memo.delete(key));
      if (memo.size > 2_000) memo.delete(memo.keys().next().value!);
      await v;
      return; // this request ran the handler: c.res is already its response
    }
    const r = await hit.v;
    c.header("x-cache", "hit");
    return c.body(r.body, r.status as 200, { "content-type": "application/json" });
  });

  const names = (wallets: Hex[]) => o.usernames(wallets).catch(() => new Map<string, string>());
  const firstEventAt = async () => {
    const [r] = await db.select({ t: sql<string>`min(${activity.timestamp})` }).from(activity);
    return r?.t ? Number(r.t) : now();
  };
  const invalid = (c: any, message: string) => c.json({ code: "INVALID_REQUEST", message }, 400);

  // ---------------------------------------------------------------- activity

  app.get("/api/activity", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const wrong = strict(search, ["cursor", "kind", "limit", "market", "user"]);
    if (wrong) return invalid(c, wrong.message);

    let kinds: Kind[] | undefined;
    const rawKind = search.get("kind");
    if (rawKind) {
      kinds = [];
      for (const k of rawKind.split(",")) {
        if (Object.hasOwn(PRESETS, k)) kinds.push(...PRESETS[k]!);
        else if ((KINDS as readonly string[]).includes(k)) kinds.push(k as Kind);
        else return invalid(c, `kind must be a comma list of: ${[...Object.keys(PRESETS), ...KINDS].join(", ")}.`);
      }
    }
    const rawUser = search.get("user");
    if (rawUser !== null && !isAddress(rawUser)) return invalid(c, "user must be a wallet address.");
    const user = rawUser ? (getAddress(rawUser).toLowerCase() as Hex) : undefined;
    const rawMarket = search.get("market");
    const marketId = rawMarket === null ? undefined : Number(rawMarket);
    if (marketId !== undefined && !o.marketIds.includes(marketId)) return invalid(c, `market must be one of: ${o.marketIds.join(", ")}.`);
    const limit = Number(search.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return invalid(c, "limit must be a whole number from 1 to 100.");
    // Cursor = the previous page's `next` (the chain order of its last event): exact, no repeats even in one block.
    const rawCursor = search.get("cursor");
    if (rawCursor !== null && !/^\d{1,30}$/.test(rawCursor)) return invalid(c, "Invalid cursor.");
    const cursor = rawCursor === null ? undefined : BigInt(rawCursor);

    const where = and(
      kinds ? inArray(activity.kind, kinds) : undefined,
      user ? eq(activity.user, user) : undefined,
      marketId !== undefined ? eq(activity.instrumentId, marketId) : undefined,
      cursor !== undefined ? lt(activity.seq, cursor) : undefined,
    );
    const rows = await db.select().from(activity).where(where).orderBy(desc(activity.seq)).limit(limit + 1);
    const page = rows.slice(0, limit);
    const n = await names([...new Set(page.flatMap((r) => (r.user ? [r.user] : [])))]);
    const last = page.at(-1);
    return c.json({
      items: page.map((r) => {
        const kind = r.kind as Kind;
        return {
          id: r.id,
          kind,
          user: r.user,
          username: r.user ? (n.get(r.user) ?? null) : null,
          market: r.instrumentId === null ? null : o.marketName(r.instrumentId),
          instrumentId: r.instrumentId,
          positionId: r.positionId === null ? null : r.positionId.toString(),
          side: r.isLong === null ? null : r.isLong ? "long" : "short",
          leverage: r.leverage === null ? null : Number(r.leverage),
          notional: r.notional === null ? null : usd(r.notional),
          price: r.price === null ? null : px(r.price),
          amount: TOKEN_KINDS.has(kind) ? tok(r.amount) : usd(r.amount),
          unit: TOKEN_KINDS.has(kind) ? "JACKTRADE" : "USDG",
          at: Number(r.timestamp),
          tx: r.tx,
        };
      }),
      next: rows.length > limit && last ? last.seq.toString() : null,
    });
  });

  // ---------------------------------------------------------------- PnL and equity of one wallet

  app.get("/api/pnl/:user", async (c) => {
    const raw = c.req.param("user");
    if (!isAddress(raw)) return invalid(c, "Invalid wallet address.");
    const user = getAddress(raw).toLowerCase() as Hex;
    const search = new URL(c.req.url).searchParams;
    const wrong = strict(search, ["window"]);
    if (wrong) return invalid(c, wrong.message);
    const window = (search.get("window") ?? "all") as Window;
    if (!Object.hasOwn(WINDOWS, window)) return invalid(c, `window must be one of: ${Object.keys(WINDOWS).join(", ")}.`);
    const from = BigInt(WINDOWS[window] === 0 ? 0 : now() - WINDOWS[window]);
    const MAX = 5_000;
    const [t, closed, moves] = await Promise.all([
      db.query.trader.findFirst({ where: eq(trader.address, user) }),
      db
        .select({ at: position.closedAt, pnl: position.pnl, id: position.id, instrumentId: position.instrumentId, status: position.status })
        .from(position)
        .where(and(eq(position.user, user), isNotNull(position.pnl), gte(position.closedAt, from)))
        .orderBy(desc(position.closedAt), desc(position.id))
        .limit(MAX),
      db
        .select({ at: transfer.timestamp, kind: transfer.kind, amount: transfer.amount })
        .from(transfer)
        .where(and(eq(transfer.user, user), gte(transfer.timestamp, from)))
        .orderBy(desc(transfer.timestamp))
        .limit(MAX),
    ]);
    type Ev = { at: number; type: string; delta: bigint; pnl: boolean; positionId?: string; market?: string };
    const events: Ev[] = [
      ...closed.map((p) => ({ at: Number(p.at), type: p.status === "liquidated" ? "liquidation" : "close", delta: p.pnl!, pnl: true, positionId: p.id.toString(), market: o.marketName(p.instrumentId) })),
      ...moves.map((m) => ({ at: Number(m.at), type: m.kind, delta: m.kind === "deposit" ? m.amount : -m.amount, pnl: false })),
    ].sort((a, b) => a.at - b.at);
    // Values before the first event shown = today's totals minus what is shown (exact even if the list was capped).
    let realized = (t?.realizedPnl ?? 0n) - events.filter((e) => e.pnl).reduce((s, e) => s + e.delta, 0n);
    let net = (t?.deposited ?? 0n) - (t?.withdrawn ?? 0n) - events.filter((e) => !e.pnl).reduce((s, e) => s + e.delta, 0n);
    const start = { realizedPnl: usd(realized), netDeposits: usd(net), equity: usd(net + realized) };
    const points = events.map((e) => {
      if (e.pnl) realized += e.delta;
      else net += e.delta;
      return {
        at: e.at,
        type: e.type,
        delta: usd(e.delta),
        ...(e.positionId ? { positionId: e.positionId, market: e.market } : {}),
        realizedPnl: usd(realized),
        netDeposits: usd(net),
        equity: usd(net + realized),
      };
    });
    return c.json({ user, window, start, points, truncated: closed.length === MAX || moves.length === MAX });
  });

  // ---------------------------------------------------------------- volume per candle

  app.get("/api/volume", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const wrong = strict(search, ["from", "interval", "market", "to"]);
    if (wrong) return invalid(c, wrong.message);
    const marketId = Number(search.get("market"));
    if (!search.has("market") || !o.marketIds.includes(marketId)) return invalid(c, `market must be one of: ${o.marketIds.join(", ")}.`);
    const VOLUME_INTERVALS = { "1m": 60, ...INTERVALS };
    const interval = search.get("interval") ?? "";
    if (!Object.hasOwn(VOLUME_INTERVALS, interval)) return invalid(c, `interval must be one of: ${Object.keys(VOLUME_INTERVALS).join(", ")}.`);
    const step = VOLUME_INTERVALS[interval as keyof typeof VOLUME_INTERVALS];
    const from = Number(search.get("from"));
    if (!search.has("from") || !Number.isInteger(from) || from < 0 || from > MAX_TIME) return invalid(c, "from must be an integer (Unix seconds).");
    const rawTo = search.has("to") ? Number(search.get("to")) : now();
    if (!Number.isInteger(rawTo) || rawTo <= from || rawTo > MAX_TIME) return invalid(c, "to must be an integer greater than from (Unix seconds).");
    // Same grid as the price candles (aligned to the interval), never past the open candle, at most 500, the newest ones.
    const to = Math.floor(Math.min(rawTo, now() + step) / step) * step;
    const start = Math.floor(Math.max(from, to - (MAX_BUCKETS - 1) * step) / step) * step;
    const bucket = bucketOf(position.openedAt, step);
    const rows = await db
      .select({ t: bucket, volume: sum(position.notional), trades: count() })
      .from(position)
      .where(and(eq(position.instrumentId, marketId), gte(position.openedAt, BigInt(start)), lt(position.openedAt, BigInt(to + step))))
      .groupBy(bucket);
    const byT = new Map(rows.map((r) => [Number(r.t), r]));
    const candles = [];
    for (let t = start; t <= to && candles.length < MAX_BUCKETS; t += step) candles.push({ t, volume: usd(big(byT.get(t)?.volume)), trades: Number(byT.get(t)?.trades ?? 0) });
    return c.json({ market: marketId, name: o.marketName(marketId), interval, candles });
  });

  // ---------------------------------------------------------------- house exposure now

  app.get("/api/house", async (c) => {
    const [open, limits, h, p, [queuedRow]] = await Promise.all([
      db
        .select({ user: position.user, instrumentId: position.instrumentId, isLong: position.isLong, margin: position.margin, leverage: position.leverage, notional: position.notional, entryPrice: position.entryPrice })
        .from(position)
        .where(eq(position.status, "open")),
      o.marketLimits().catch(() => new Map()),
      o.house(),
      db.query.protocol.findFirst({ where: eq(protocol.id, 1) }),
      db.select({ n: count() }).from(queueEntry).where(gt(queueEntry.remaining, 0n)),
    ]);
    const markets = o.marketIds.map((id) => {
      const rows = open.filter((r) => r.instrumentId === id);
      const price = o.markPrice(id);
      const lim = limits.get(id);
      return {
        instrumentId: id,
        name: o.marketName(id),
        price: price === undefined ? null : px(price),
        longOiCap: lim ? usd(lim.longOiCap) : null,
        shortOiCap: lim ? usd(lim.shortOiCap) : null,
        ...exposure(rows, price, lim?.liqBufferBps),
      };
    });
    return c.json({
      bankroll: usd(h.bankroll),
      lpCash: usd(h.lpCash),
      queue: usd(p?.totalQueued ?? 0n),
      queuedPayouts: Number(queuedRow?.n ?? 0),
      housePnl: usd(-(p?.traderPnl ?? 0n)),
      fees: usd(p?.fees ?? 0n),
      paused: h.paused,
      positions: open.length,
      margin: usd(open.reduce((s, r) => s + r.margin, 0n)),
      markets,
    });
  });

  // ---------------------------------------------------------------- protocol totals over time

  app.get("/api/stats/history", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const wrong = strict(search, ["interval", "window"]);
    if (wrong) return invalid(c, wrong.message);
    const q = parseSeries(search, await firstEventAt());
    if (!q.ok) return invalid(c, q.message);
    const { from, to, step } = q;
    // Last point per bucket in the database (DISTINCT ON), plus the last one before the window as the starting value.
    const bucket = bucketOf(protocolPoint.timestamp, step);
    const [rows, [before]] = await Promise.all([
      db
        .selectDistinctOn([bucket], { t: bucket, p: protocolPoint })
        .from(protocolPoint)
        .where(and(gte(protocolPoint.timestamp, BigInt(from)), lt(protocolPoint.timestamp, BigInt(to + step))))
        .orderBy(bucket, desc(protocolPoint.seq)),
      db.select().from(protocolPoint).where(lt(protocolPoint.timestamp, BigInt(from))).orderBy(desc(protocolPoint.seq)).limit(1),
    ]);
    type P = typeof protocolPoint.$inferSelect;
    const series = fillBuckets<P>(
      rows.map((r) => ({ t: Number(r.t), v: r.p })).sort((a, b) => a.t - b.t),
      from,
      to,
      step,
      before ?? null,
    );
    const mBucket = bucketOf(marketPoint.timestamp, step);
    const markets = await Promise.all(
      o.marketIds.map(async (id) => {
        const [mrows, [mb]] = await Promise.all([
          db
            .selectDistinctOn([mBucket], { t: mBucket, longOi: marketPoint.longOi, shortOi: marketPoint.shortOi })
            .from(marketPoint)
            .where(and(eq(marketPoint.instrumentId, id), gte(marketPoint.timestamp, BigInt(from)), lt(marketPoint.timestamp, BigInt(to + step))))
            .orderBy(mBucket, desc(marketPoint.seq)),
          db
            .select({ longOi: marketPoint.longOi, shortOi: marketPoint.shortOi })
            .from(marketPoint)
            .where(and(eq(marketPoint.instrumentId, id), lt(marketPoint.timestamp, BigInt(from))))
            .orderBy(desc(marketPoint.seq))
            .limit(1),
        ]);
        const filled = fillBuckets(
          mrows.map((r) => ({ t: Number(r.t), v: { longOi: r.longOi, shortOi: r.shortOi } })).sort((a, b) => a.t - b.t),
          from,
          to,
          step,
          mb ?? null,
        );
        return {
          instrumentId: id,
          name: o.marketName(id),
          points: filled.map(({ t, v }) => ({ t, longOi: usd(v?.longOi ?? 0n), shortOi: usd(v?.shortOi ?? 0n) })),
        };
      }),
    );
    return c.json({
      window: q.window,
      interval: q.interval,
      points: series.map(({ t, v }) => ({
        t,
        housePnl: usd(-(v?.traderPnl ?? 0n)),
        fees: usd(v?.fees ?? 0n),
        queue: usd(v?.totalQueued ?? 0n),
        deposits: usd(v?.deposits ?? 0n),
        withdrawals: usd(v?.withdrawals ?? 0n),
        stakerRewards: usd(v?.stakerFeesPushed ?? 0n),
        volume: usd(v?.volume ?? 0n),
        open: v?.open ?? 0,
        longOi: usd(v?.longOi ?? 0n),
        shortOi: usd(v?.shortOi ?? 0n),
      })),
      markets,
    });
  });

  // ---------------------------------------------------------------- JACKTRADE token and staking

  app.get("/api/token", async (c) => {
    const [chainData, p, [stakers], [minted], [last]] = await Promise.all([
      o.token(),
      db.query.protocol.findFirst({ where: eq(protocol.id, 1) }),
      db.select({ n: count() }).from(stake).where(gt(stake.staked, 0n)),
      db.select({ total: sum(trader.minted) }).from(trader),
      db.select().from(activity).where(eq(activity.kind, "distribution")).orderBy(desc(activity.seq)).limit(1),
    ]);
    return c.json({
      token: {
        address: o.tokenAddress,
        symbol: "JACKTRADE",
        decimals: 18,
        totalSupply: tok(chainData.totalSupply),
        transfersEnabled: chainData.transfersEnabled,
        minted: tok(big(minted?.total)),
      },
      rate: tok(chainData.rate),
      staking: {
        totalStaked: tok(chainData.totalStaked),
        stakers: Number(stakers?.n ?? 0),
        stakedShare: chainData.totalSupply > 0n ? Number((chainData.totalStaked * 10_000n) / chainData.totalSupply) / 100 : null,
      },
      rewards: {
        distributed: usd((p?.stakerFeesPushed ?? 0n) + (p?.lpExcessPushed ?? 0n)),
        fromFees: usd(p?.stakerFeesPushed ?? 0n),
        fromLpExcess: usd(p?.lpExcessPushed ?? 0n),
        lastDistribution: last ? { at: Number(last.timestamp), amount: usd(last.amount), tx: last.tx } : null,
      },
    });
  });

  app.get("/api/token/history", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const wrong = strict(search, ["interval", "window"]);
    if (wrong) return invalid(c, wrong.message);
    const q = parseSeries(search, await firstEventAt());
    if (!q.ok) return invalid(c, q.message);
    const { from, to, step } = q;
    const inWindow = and(gte(activity.timestamp, BigInt(from)), lt(activity.timestamp, BigInt(to + step)));
    const bucket = bucketOf(activity.timestamp, step);
    const perBucket = (kind: Kind) =>
      db.select({ t: bucket, v: sum(activity.amount) }).from(activity).where(and(eq(activity.kind, kind), inWindow)).groupBy(bucket);
    const stakedBefore = async () => {
      const [r] = await db
        .select({ v: sql<string>`coalesce(sum(case when ${activity.kind} = 'stake' then ${activity.amount} else -${activity.amount} end), 0)` })
        .from(activity)
        .where(and(inArray(activity.kind, ["stake", "unstake"]), lt(activity.timestamp, BigInt(from))));
      return big(r?.v);
    };
    const [dist, mint, stakes, unstakes, base] = await Promise.all([perBucket("distribution"), perBucket("mint"), perBucket("stake"), perBucket("unstake"), stakedBefore()]);
    const rows = (r: { t: string; v: string | null }[]) => r.map((x) => ({ t: Number(x.t), v: big(x.v) }));
    const distributed = sumBuckets(rows(dist), from, to, step);
    const mintedS = sumBuckets(rows(mint), from, to, step);
    const staked = sumBuckets(rows(stakes), from, to, step);
    const unstaked = sumBuckets(rows(unstakes), from, to, step);
    let total = base;
    return c.json({
      window: q.window,
      interval: q.interval,
      points: distributed.map((d, i) => {
        total += staked[i]!.v - unstaked[i]!.v;
        return { t: d.t, distributed: usd(d.v), minted: tok(mintedS[i]!.v), totalStaked: tok(total) };
      }),
    });
  });
}
