import { config } from "./config.ts";

// JackTrade Points: 10 points for every $100 of notional (margin × leverage), win or lose.
// Notional comes straight from the exchange's onchain trade history via the indexer, so
// points can be recomputed by anyone from public data.

export const POINTS_PER_100_NOTIONAL = 10;

export function pointsFor(notionalUsd: number): number {
  return Math.floor((notionalUsd * POINTS_PER_100_NOTIONAL) / 100);
}

type Account = { stats?: { volume?: string; trades?: number } };
type LeaderboardRow = { user: string; username?: string | null; volume: string; trades: number };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${config.indexerUrl}${path}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`indexer ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function pointsOf(wallet: string) {
  const account = await getJson<Account>(`/api/account/${wallet}`);
  const notionalUsd = Number(account.stats?.volume ?? 0);
  return {
    wallet,
    trades: account.stats?.trades ?? 0,
    notionalUsd,
    points: pointsFor(notionalUsd),
    rule: `${POINTS_PER_100_NOTIONAL} points per $100 of notional, win or lose`,
  };
}

export async function pointsLeaderboard(limit = 25) {
  const res = await getJson<{ accounts: LeaderboardRow[] }>(
    "/api/leaderboard/accounts?window=all&sortKey=volume&sortDir=desc",
  );
  return res.accounts.slice(0, limit).map((a, i) => ({
    rank: i + 1,
    wallet: a.user,
    username: a.username ?? null,
    trades: a.trades,
    notionalUsd: Number(a.volume),
    points: pointsFor(Number(a.volume)),
  }));
}
