import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.ts";

// Keeps the onchain JackTradePoints ledger in step with each trader's cumulative notional.
// Notional comes from the exchange's indexer; the contract only ever credits increases, so
// re-running a sync is safe.

const SYNC_MS = 60_000;
const BATCH = 100;

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

export const pointsAbi = parseAbi([
  "function notionalSynced(address user) view returns (uint256)",
  "function balanceOf(address user) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function sync(address[] users, uint256[] cumulativeNotional)",
]);

type Row = { user: `0x${string}`; volume: string };

/** "26100" or "21.4567891" → 6-decimal raw units, without float rounding. */
function toRaw(volume: string): bigint {
  const [whole, frac = ""] = volume.split(".");
  return parseUnits(`${whole}.${frac.slice(0, 6) || "0"}`, 6);
}

async function allAccounts(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(
      `${config.indexerUrl}/api/leaderboard/accounts?window=all&sortKey=volume&sortDir=desc&page=${page}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) throw new Error(`indexer leaderboard → HTTP ${res.status}`);
    const body = (await res.json()) as { accounts: Row[] };
    if (!body.accounts?.length) break;
    rows.push(...body.accounts);
    if (body.accounts.length < 25) break;
  }
  return rows;
}

export async function syncPointsOnce(): Promise<{ synced: number; tx: string | null }> {
  const address = config.pointsAddress as `0x${string}`;
  const account = privateKeyToAccount(config.pointsSyncerKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: robinhood, transport: http(config.rpcUrl) });
  const wallet = createWalletClient({ account, chain: robinhood, transport: http(config.rpcUrl) });

  const rows = await allAccounts();
  const due: { user: `0x${string}`; raw: bigint }[] = [];
  for (const r of rows) {
    const raw = toRaw(r.volume);
    if (raw === 0n) continue;
    const synced = await publicClient.readContract({ address, abi: pointsAbi, functionName: "notionalSynced", args: [r.user] });
    if (raw > synced) due.push({ user: r.user, raw });
  }
  let tx: string | null = null;
  for (let i = 0; i < due.length; i += BATCH) {
    const chunk = due.slice(i, i + BATCH);
    tx = await wallet.writeContract({
      address,
      abi: pointsAbi,
      functionName: "sync",
      args: [chunk.map((d) => d.user), chunk.map((d) => d.raw)],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` });
  }
  return { synced: due.length, tx };
}

export function startPointsSync(): void {
  if (!config.pointsAddress || !config.pointsSyncerKey) return;
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    syncPointsOnce()
      .then((r) => r.synced && console.log(`points sync: credited ${r.synced} trader(s), tx ${r.tx}`))
      .catch((e) => console.warn("points sync failed", e instanceof Error ? e.message : e))
      .finally(() => {
        running = false;
      });
  };
  run();
  setInterval(run, SYNC_MS);
}
