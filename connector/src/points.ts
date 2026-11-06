import { createPublicClient, formatUnits, http } from "viem";
import { config } from "./config.ts";
import { pointsAbi, robinhood } from "./pointsSync.ts";

// JackTrade Points: 10 points for every $100 of notional (margin × leverage), win or lose.
// The JackTradePoints contract on Robinhood Chain is the source of truth; this mirrors its
// math exactly (fractions kept) so the app and the chain always agree.

export const POINTS_PER_100_NOTIONAL = 10;

export function pointsFor(notionalUsd: number): number {
  return Math.round(notionalUsd * POINTS_PER_100_NOTIONAL) / 100;
}

type Account = { stats?: { volume?: string; trades?: number } };
type LeaderboardRow = { user: string; username?: string | null; volume: string; trades: number };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${config.indexerUrl}${path}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`indexer ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function onchainPoints(wallet: string): Promise<number | null> {
  if (!config.pointsAddress) return null;
  try {
    const client = createPublicClient({ chain: robinhood, transport: http(config.rpcUrl) });
    const bal = await client.readContract({
      address: config.pointsAddress as `0x${string}`,
      abi: pointsAbi,
      functionName: "balanceOf",
      args: [wallet as `0x${string}`],
    });
    return Number(formatUnits(bal, 18));
  } catch {
    return null;
  }
}

export async function pointsOf(wallet: string) {
  const [account, onchain] = await Promise.all([getJson<Account>(`/api/account/${wallet}`), onchainPoints(wallet)]);
  const notionalUsd = Number(account.stats?.volume ?? 0);
  return {
    wallet,
    trades: account.stats?.trades ?? 0,
    notionalUsd,
    points: pointsFor(notionalUsd),
    onchainPoints: onchain,
    contract: config.pointsAddress || null,
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
