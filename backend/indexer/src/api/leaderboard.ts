import { createHash } from "node:crypto";

import { db } from "ponder:api";
import { position, queueEntry, stake, trader } from "ponder:schema";
import type { Context, Hono } from "hono";
import { and, desc, gt, gte, inArray, isNotNull, sql, sum } from "ponder";
import { formatUnits, type Hex } from "viem";

import {
  assignRanks,
  estimatePnl,
  matches,
  PAGE_SIZE,
  parseAccountsQuery,
  parsePositionsQuery,
  roiBps,
  sortAccounts,
  TOP_POSITIONS,
  winRateBps,
  WINDOWS,
  type AccountRow,
  type Window,
} from "../leaderboard/rules.js";

/**
 * Leaderboard v2 (all messages in English):
 *   GET /api/leaderboard/positions?window=   top closed positions by PnL in the window
 *   GET /api/leaderboard/accounts?page=&q=&sortDir=&sortKey=&window=   ranked accounts, 25 per page
 * The ranking is computed from the indexer tables on request and kept for a couple of seconds per window, so many
 * viewers cost one computation. Responses carry a short Cache-Control and an ETag (a CDN in front can absorb the rest).
 */
export type LeaderboardOptions = {
  /** Price the API would show now (WAD), or undefined if it has none (stale or retired without frozen price). */
  markPrice: (instrumentId: number) => bigint | undefined;
  marketName: (instrumentId: number) => string;
  usernames: (wallets: Hex[]) => Promise<Map<string, string>>;
  minTrades: number;
  cacheMs?: number;
};

const usd = (v: bigint) => formatUnits(v, 6);
const px = (v: bigint) => formatUnits(v, 18);
const pct = (bps: bigint | number | null) => (bps === null ? null : Number(bps) / 100);
const since = (w: Window) => (WINDOWS[w] === 0 ? 0n : BigInt(Math.floor(Date.now() / 1000) - WINDOWS[w]));

export function leaderboardRoutes(app: Hono<any>, o: LeaderboardOptions) {
  const cacheMs = o.cacheMs ?? 2_000;
  const memo = new Map<string, { at: number; v: Promise<unknown> }>();
  function remember<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < cacheMs) return hit.v as Promise<T>;
    const v = fn();
    memo.set(key, { at: Date.now(), v });
    v.catch(() => memo.delete(key)); // an error is not kept
    return v;
  }
  const names = (wallets: Hex[]) => o.usernames(wallets).catch(() => new Map<string, string>()); // ranking works without names

  // ---------------------------------------------------------------- positions

  app.get("/api/leaderboard/positions", async (c) => {
    const query = parsePositionsQuery(new URL(c.req.url).searchParams);
    if (!query.ok) return c.json({ code: "INVALID_REQUEST", message: query.message }, 400);
    const body = await remember(`positions:${query.window}`, async () => {
      const rows = await db
        .select()
        .from(position)
        .where(and(isNotNull(position.pnl), gte(position.closedAt, since(query.window))))
        .orderBy(desc(position.pnl), desc(position.closedAt))
        .limit(TOP_POSITIONS);
      const n = await names([...new Set(rows.map((p) => p.user))]);
      return {
        window: query.window,
        positions: rows.map((p, i) => ({
          rank: i + 1,
          id: p.id.toString(),
          user: p.user,
          username: n.get(p.user) ?? null,
          market: o.marketName(p.instrumentId),
          instrumentId: p.instrumentId,
          side: p.isLong ? "long" : "short",
          leverage: Number(p.leverage),
          margin: usd(p.margin),
          notional: usd(p.notional),
          entryPrice: px(p.entryPrice),
          exitPrice: px(p.exitPrice!),
          pnl: usd(p.pnl!),
          roi: pct(roiBps(p.pnl!, p.margin)),
          liquidated: p.status === "liquidated",
          openedAt: Number(p.openedAt),
          closedAt: Number(p.closedAt!),
        })),
      };
    });
    return cachedJson(c, body);
  });

  // ---------------------------------------------------------------- accounts

  /** Every account active in the window, with its metrics and rank (before search, sort and paging). */
  const accounts = (window: Window) =>
    remember(`accounts:${window}`, async () => {
      const from = since(window);
      const [closed, opened, open, queued, stakes] = await Promise.all([
        db
          .select({
            user: position.user,
            pnl: sum(position.pnl),
            margin: sum(position.margin),
            trades: sql<string>`count(*)`,
            wins: sql<string>`count(*) filter (where ${position.pnl} > 0)`,
            liquidations: sql<string>`count(*) filter (where ${position.status} = 'liquidated')`,
          })
          .from(position)
          .where(and(isNotNull(position.pnl), gte(position.closedAt, from)))
          .groupBy(position.user),
        db.select({ user: position.user, volume: sum(position.notional) }).from(position).where(gte(position.openedAt, from)).groupBy(position.user),
        db
          .select({ user: position.user, instrumentId: position.instrumentId, isLong: position.isLong, margin: position.margin, notional: position.notional, entryPrice: position.entryPrice })
          .from(position)
          .where(sql`${position.status} = 'open'`),
        db.select({ user: queueEntry.user, remaining: sum(queueEntry.remaining) }).from(queueEntry).where(gt(queueEntry.remaining, 0n)).groupBy(queueEntry.user),
        db.select().from(stake),
      ]);

      // With window=all, stakers who never traded are in the table too (the "house owners" view sorts by staked).
      const stakers = window === "all" ? stakes.filter((s) => s.staked > 0n).map((s) => s.user) : [];
      const users = [...new Set([...closed.map((r) => r.user), ...opened.map((r) => r.user), ...stakers])];
      const traders = users.length ? await db.select().from(trader).where(inArray(trader.address, users)) : [];
      const n = await names(users);
      const byUser = <T extends { user: string }>(rows: T[]) => new Map(rows.map((r) => [r.user, r]));
      const closedBy = byUser(closed);
      const openedBy = byUser(opened);
      const queuedBy = byUser(queued);
      const stakeBy = byUser(stakes);
      const traderBy = new Map(traders.map((t) => [t.address, t]));
      const openBy = new Map<string, typeof open>();
      for (const p of open) openBy.set(p.user, [...(openBy.get(p.user) ?? []), p]);

      const rows: AccountRow[] = users.map((user) => {
        const cl = closedBy.get(user);
        const t = traderBy.get(user);
        const st = stakeBy.get(user);
        const mine = openBy.get(user) ?? [];
        let unrealized: bigint | null = 0n;
        for (const p of mine) {
          const price = o.markPrice(p.instrumentId);
          if (price === undefined) {
            unrealized = null;
            break;
          }
          unrealized += estimatePnl(p, price);
        }
        return {
          user,
          username: n.get(user) ?? null,
          pnl: BigInt(cl?.pnl ?? 0),
          closedMargin: BigInt(cl?.margin ?? 0),
          trades: Number(cl?.trades ?? 0),
          wins: Number(cl?.wins ?? 0),
          liquidations: Number(cl?.liquidations ?? 0),
          volume: BigInt(openedBy.get(user)?.volume ?? 0),
          realizedPnl: t?.realizedPnl ?? 0n,
          unrealizedPnl: unrealized,
          openNotional: mine.reduce((s, p) => s + p.notional, 0n),
          queued: BigInt(queuedBy.get(user)?.remaining ?? 0),
          // Every claim is credited to the Exchange balance (capped by the reserve): `credited` is what was really paid.
          stakingRewards: st?.credited ?? 0n,
          staked: st?.staked ?? 0n,
          minted: t?.minted ?? 0n,
          lastActive: Number(t?.lastActive ?? 0),
          rank: null,
        };
      });
      assignRanks(rows, o.minTrades);

      const total = (f: (r: AccountRow) => bigint) => rows.reduce((s, r) => s + f(r), 0n);
      return {
        rows,
        summary: {
          accounts: rows.length,
          ranked: rows.filter((r) => r.rank !== null).length,
          trades: rows.reduce((s, r) => s + r.trades, 0),
          volume: usd(total((r) => r.volume)),
          pnl: usd(total((r) => r.pnl)),
          // Protocol-wide, not only the window's accounts.
          openNotional: usd(open.reduce((s, p) => s + p.notional, 0n)),
          queued: usd(queued.reduce((s, r) => s + BigInt(r.remaining ?? 0), 0n)),
        },
      };
    });

  app.get("/api/leaderboard/accounts", async (c) => {
    const query = parseAccountsQuery(new URL(c.req.url).searchParams);
    if (!query.ok) return c.json({ code: "INVALID_REQUEST", message: query.message }, 400);
    const { rows, summary } = await accounts(query.window);
    const found = sortAccounts(
      rows.filter((r) => matches(r, query.q)),
      query.sortKey,
      query.sortDir,
    );
    const totalPages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
    const page = found.slice(query.page * PAGE_SIZE, (query.page + 1) * PAGE_SIZE);
    return cachedJson(c, {
      window: query.window,
      count: found.length,
      summary,
      accounts: page.map((r) => ({
        rank: r.rank,
        user: r.user,
        username: r.username,
        pnl: usd(r.pnl),
        roi: pct(roiBps(r.pnl, r.closedMargin)),
        trades: r.trades,
        wins: r.wins,
        winRate: pct(winRateBps(r.wins, r.trades)),
        liquidations: r.liquidations,
        margin: usd(r.closedMargin),
        volume: usd(r.volume),
        realizedPnl: usd(r.realizedPnl),
        unrealizedPnl: r.unrealizedPnl === null ? null : usd(r.unrealizedPnl),
        openNotional: usd(r.openNotional),
        queued: usd(r.queued),
        stakingRewards: usd(r.stakingRewards),
        staked: formatUnits(r.staked, 18),
        minted: formatUnits(r.minted, 18),
        lastActive: r.lastActive,
      })),
      pageInfo: { page: query.page, pageSize: PAGE_SIZE, totalPages },
    });
  });
}

/** JSON with a 1 s public cache and an ETag; answers 304 when the client already has this exact body. */
function cachedJson(c: Context, body: unknown) {
  const text = JSON.stringify(body);
  const etag = `"lb-${createHash("sha1").update(text).digest("base64url").slice(0, 16)}"`;
  c.header("cache-control", "public, max-age=1, must-revalidate");
  c.header("etag", etag);
  if (c.req.header("if-none-match") === etag) return c.body(null, 304);
  return c.body(text, 200, { "content-type": "application/json" });
}
