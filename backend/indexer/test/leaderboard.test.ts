import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assignRanks,
  estimatePnl,
  matches,
  parseAccountsQuery,
  parsePositionsQuery,
  roiBps,
  sortAccounts,
  winRateBps,
  type AccountRow,
} from "../src/leaderboard/rules.js";

const q = (s: string) => new URLSearchParams(s);
const WAD = 10n ** 18n;
const USD = 10n ** 6n;

test("positions query: window only, defaults to all", () => {
  assert.deepEqual(parsePositionsQuery(q("")), { ok: true, window: "all" });
  assert.deepEqual(parsePositionsQuery(q("window=7d")), { ok: true, window: "7d" });
  assert.equal(parsePositionsQuery(q("window=1y")).ok, false);
  assert.equal(parsePositionsQuery(q("window=7d&limit=500")).ok, false);
});

test("accounts query: strict, with defaults", () => {
  assert.deepEqual(parseAccountsQuery(q("")), { ok: true, window: "all", page: 0, q: "", sortKey: "rank", sortDir: "asc" });
  assert.deepEqual(parseAccountsQuery(q("sortKey=volume&window=24h&page=2&q=House")), { ok: true, window: "24h", page: 2, q: "house", sortKey: "volume", sortDir: "desc" });
  for (const bad of ["limit=100", "page=-1", "page=1.5", "sortKey=balance", "sortDir=up", "window=1y", "page=1&page=2", `q=${"a".repeat(43)}`]) {
    assert.equal(parseAccountsQuery(q(bad)).ok, false, bad);
  }
});

const row = (user: string, over: Partial<AccountRow> = {}): AccountRow => ({
  user: user as `0x${string}`,
  username: null,
  pnl: 0n,
  closedMargin: 0n,
  trades: 1,
  wins: 0,
  liquidations: 0,
  volume: 0n,
  realizedPnl: 0n,
  unrealizedPnl: 0n,
  openNotional: 0n,
  queued: 0n,
  stakingRewards: 0n,
  staked: 0n,
  minted: 0n,
  lastActive: 0,
  rank: null,
  ...over,
});

test("ranking: by window PnL, ties by volume then address; under minTrades gets no rank", () => {
  const rows = [
    row("0xa", { pnl: 10n * USD, volume: 1n }),
    row("0xb", { pnl: 50n * USD }),
    row("0xc", { pnl: 10n * USD, volume: 5n }),
    row("0xd", { pnl: 999n * USD, trades: 0 }), // only opened in the window
    row("0xe", { pnl: -5n * USD }),
  ];
  assignRanks(rows, 1);
  assert.deepEqual(
    rows.map((r) => [r.user, r.rank]),
    [["0xa", 3], ["0xb", 1], ["0xc", 2], ["0xd", null], ["0xe", 4]],
  );
  assignRanks(rows, 2); // nobody has 2 trades
  assert.ok(rows.every((r) => r.rank === null));
});

test("sorting keeps the real rank and puts nulls last", () => {
  const rows = assignRanks([row("0xa", { pnl: 3n, volume: 1n }), row("0xb", { pnl: 2n, volume: 9n }), row("0xc", { trades: 0, volume: 5n })], 1);
  assert.deepEqual(sortAccounts(rows, "rank", "asc").map((r) => r.user), ["0xa", "0xb", "0xc"]);
  assert.deepEqual(sortAccounts(rows, "rank", "desc").map((r) => r.user), ["0xb", "0xa", "0xc"]);
  const byVolume = sortAccounts(rows, "volume", "desc");
  assert.deepEqual(byVolume.map((r) => [r.user, r.rank]), [["0xb", 2], ["0xc", null], ["0xa", 1]]);
  const withNull = [row("0xa", { unrealizedPnl: null }), row("0xb", { unrealizedPnl: -1n })];
  assert.deepEqual(sortAccounts(withNull, "unrealizedPnl", "asc").map((r) => r.user), ["0xb", "0xa"]);
  assert.deepEqual(sortAccounts(withNull, "unrealizedPnl", "desc").map((r) => r.user), ["0xb", "0xa"]);
});

test("search matches address or username", () => {
  const r = row("0xabcdef", { username: "house.trader" });
  assert.ok(matches(r, ""));
  assert.ok(matches(r, "cdef"));
  assert.ok(matches(r, "trader"));
  assert.ok(!matches(r, "whale"));
});

test("ROI and win rate", () => {
  assert.equal(roiBps(121n * USD, 75n * USD), 16_133n); // +161.33 %
  assert.equal(roiBps(1n, 0n), null);
  assert.equal(winRateBps(2, 3), 6_666);
  assert.equal(winRateBps(0, 0), null);
});

test("unrealized PnL estimate: linear, loss capped at the margin", () => {
  const long = { isLong: true, margin: 100n * USD, notional: 1_000n * USD, entryPrice: 100n * WAD };
  assert.equal(estimatePnl(long, 110n * WAD), 100n * USD); // +10 % × 1000
  assert.equal(estimatePnl({ ...long, isLong: false }, 110n * WAD), -100n * USD);
  assert.equal(estimatePnl(long, 50n * WAD), -100n * USD); // −500 capped at −100
});
