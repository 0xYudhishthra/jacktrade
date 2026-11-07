import type { Hex } from "viem";

/**
 * Leaderboard v2: query parsing, ranking and sorting. Pure logic (no database, no HTTP) so it can be tested on its own.
 * Amounts are raw bigints (USDG, 6 decimals; JACKTRADE, 18); the routes format them.
 */

export const WINDOWS = { "24h": 86_400, "7d": 7 * 86_400, "30d": 30 * 86_400, all: 0 } as const;
export type Window = keyof typeof WINDOWS;

export const PAGE_SIZE = 25;
export const TOP_POSITIONS = 15;

export const SORT_KEYS = [
  "rank",
  "user",
  "pnl",
  "roi",
  "unrealizedPnl",
  "realizedPnl",
  "volume",
  "trades",
  "winRate",
  "liquidations",
  "margin",
  "openNotional",
  "queued",
  "stakingRewards",
  "staked",
  "minted",
  "lastActive",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type QueryError = { ok: false; message: string };

/**
 * Strict query: only the listed params, each at most once, with valid values. Anything else is a 400, so nobody can ask
 * for huge pages and every view maps to few distinct URLs (better cache hits).
 */
function strict(search: URLSearchParams, allowed: readonly string[]): QueryError | undefined {
  const seen = new Set<string>();
  for (const key of search.keys()) {
    if (!allowed.includes(key)) return { ok: false, message: `Unknown query parameter "${key}". Allowed: ${allowed.join(", ")}.` };
    if (seen.has(key)) return { ok: false, message: `Query parameter "${key}" is repeated.` };
    seen.add(key);
  }
  return undefined;
}

function parseWindow(raw: string | null): Window | undefined {
  if (raw === null) return "all";
  return Object.hasOwn(WINDOWS, raw) ? (raw as Window) : undefined;
}

const WINDOW_MESSAGE = `window must be one of: ${Object.keys(WINDOWS).join(", ")}.`;

export function parsePositionsQuery(search: URLSearchParams): { ok: true; window: Window } | QueryError {
  const bad = strict(search, ["window"]);
  if (bad) return bad;
  const window = parseWindow(search.get("window"));
  return window ? { ok: true, window } : { ok: false, message: WINDOW_MESSAGE };
}

export type AccountsQuery = { window: Window; page: number; q: string; sortKey: SortKey; sortDir: "asc" | "desc" };

export function parseAccountsQuery(search: URLSearchParams): ({ ok: true } & AccountsQuery) | QueryError {
  const bad = strict(search, ["page", "q", "sortDir", "sortKey", "window"]);
  if (bad) return bad;
  const window = parseWindow(search.get("window"));
  if (!window) return { ok: false, message: WINDOW_MESSAGE };
  const rawPage = search.get("page") ?? "0";
  if (!/^\d{1,6}$/.test(rawPage)) return { ok: false, message: "page must be a whole number starting at 0." };
  const q = (search.get("q") ?? "").trim().toLowerCase();
  if (q.length > 42) return { ok: false, message: "q must be at most 42 characters." };
  const sortKey = (search.get("sortKey") ?? "rank") as SortKey;
  if (!SORT_KEYS.includes(sortKey)) return { ok: false, message: `sortKey must be one of: ${SORT_KEYS.join(", ")}.` };
  const rawDir = search.get("sortDir");
  if (rawDir !== null && rawDir !== "asc" && rawDir !== "desc") return { ok: false, message: "sortDir must be asc or desc." };
  // Default direction: rank and user ascending, every metric descending (biggest first).
  const sortDir = rawDir ?? (sortKey === "rank" || sortKey === "user" ? "asc" : "desc");
  return { ok: true, window, page: Number(rawPage), q, sortKey, sortDir };
}

// ---------------------------------------------------------------- accounts

export type AccountRow = {
  user: Hex;
  username: string | null;
  /** Realized PnL of positions closed in the window (the ranking metric). */
  pnl: bigint;
  /** Margin of positions closed in the window (for ROI). */
  closedMargin: bigint;
  /** Closed in the window. */
  trades: number;
  wins: number;
  /** Closed in the window by liquidation. */
  liquidations: number;
  /** Notional opened in the window. */
  volume: bigint;
  /** All-time realized PnL. */
  realizedPnl: bigint;
  /** Estimated PnL of open positions at the current price (null if a price is missing). */
  unrealizedPnl: bigint | null;
  openNotional: bigint;
  queued: bigint;
  stakingRewards: bigint;
  /** JACKTRADE staked now (18 decimals). */
  staked: bigint;
  minted: bigint;
  lastActive: number;
  rank: number | null;
};

/**
 * Ranks by realized PnL in the window. Only accounts with at least `minTrades` positions closed in the window get a rank;
 * ties go to the bigger volume, then to the address (stable order). Unrealized PnL is shown but never ranked: it can be
 * pumped right before a snapshot and it is only an estimate.
 */
export function assignRanks(rows: AccountRow[], minTrades: number) {
  const ranked = rows
    .filter((r) => r.trades >= Math.max(1, minTrades))
    .sort((a, b) => cmpBig(b.pnl, a.pnl) || cmpBig(b.volume, a.volume) || a.user.localeCompare(b.user));
  ranked.forEach((r, i) => (r.rank = i + 1));
  for (const r of rows) if (!ranked.includes(r)) r.rank = null;
  return rows;
}

const cmpBig = (a: bigint, b: bigint) => (a > b ? 1 : a < b ? -1 : 0);
const cmpNullable = <T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number, dir: 1 | -1) => {
  // null always last, whatever the direction
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return cmp(a, b) * dir;
};

/** ROI in basis points of the closed margin (bigint math, no float drift). */
export const roiBps = (pnl: bigint, margin: bigint) => (margin > 0n ? (pnl * 10_000n) / margin : null);
export const winRateBps = (wins: number, trades: number) => (trades > 0 ? Math.floor((wins * 10_000) / trades) : null);

export function sortAccounts(rows: AccountRow[], key: SortKey, dir: "asc" | "desc") {
  const d = dir === "asc" ? 1 : -1;
  const value = (r: AccountRow): bigint | number | string | null => {
    switch (key) {
      case "rank":
        return r.rank;
      case "user":
        return r.user;
      case "roi":
        return roiBps(r.pnl, r.closedMargin);
      case "winRate":
        return winRateBps(r.wins, r.trades);
      case "margin":
        return r.closedMargin;
      default:
        return r[key];
    }
  };
  const cmp = (x: bigint | number | string, y: bigint | number | string) =>
    typeof x === "bigint" ? cmpBig(x, y as bigint) : typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y));
  return [...rows].sort((a, b) => cmpNullable(value(a), value(b), cmp, d) || cmpNullable(a.rank, b.rank, (x, y) => x - y, 1) || a.user.localeCompare(b.user));
}

/** Search by address (substring) or username (substring), case-insensitive. */
export function matches(r: AccountRow, q: string) {
  if (!q) return true;
  return r.user.includes(q) || (r.username?.includes(q) ?? false);
}

// ---------------------------------------------------------------- unrealized PnL (estimate)

/**
 * Linear estimate of an open position's PnL at `price`: notional × move, with the loss capped at the margin. It skips the
 * contract's deadband, price impact and fees, so it is only for ranking tables (the exact figure is /api/preview/:id).
 */
export function estimatePnl(p: { isLong: boolean; margin: bigint; notional: bigint; entryPrice: bigint }, price: bigint) {
  if (p.entryPrice === 0n) return 0n;
  const move = ((price - p.entryPrice) * p.notional) / p.entryPrice;
  const pnl = p.isLong ? move : -move;
  return pnl < -p.margin ? -p.margin : pnl;
}
