import assert from "node:assert/strict";
import { test } from "node:test";

import { exposure, fillBuckets, parseSeries, strict, sumBuckets, type OpenRow } from "../src/feeds/rules.js";

const q = (s: string) => new URLSearchParams(s);
const WAD = 10n ** 18n;
const USD = 10n ** 6n;

test("series query: window and interval on an aligned grid, strict params", () => {
  const at = 1_800_000_000;
  const r = parseSeries(q("window=24h"), 0, at);
  assert.ok(r.ok);
  assert.equal(r.interval, "15m");
  assert.equal(r.to % 900, 0);
  assert.equal(r.from % 900, 0);
  assert.ok(at - r.from >= 86_400);
  const all = parseSeries(q("window=all&interval=1d"), at - 10 * 86_400, at);
  assert.ok(all.ok && (all.to - all.from) / 86_400 === 10);
  assert.equal(parseSeries(q("window=1y"), 0, at).ok, false);
  assert.equal(parseSeries(q("window=30d&interval=5m"), 0, at).ok, false); // more than 500 points
  assert.ok(strict(q("window=7d&foo=1"), ["window"]));
  assert.ok(strict(q("window=7d&window=24h"), ["window"]));
  assert.equal(strict(q("window=7d"), ["window"]), undefined);
});

test("fillBuckets keeps the last value per bucket and carries it forward", () => {
  const rows = [
    { t: 105, v: "a" },
    { t: 110, v: "b" },
    { t: 320, v: "c" },
  ];
  assert.deepEqual(fillBuckets(rows, 100, 400, 100, null), [
    { t: 100, v: "b" },
    { t: 200, v: "b" },
    { t: 300, v: "c" },
    { t: 400, v: "c" },
  ]);
  assert.deepEqual(fillBuckets([], 0, 100, 100, "start"), [
    { t: 0, v: "start" },
    { t: 100, v: "start" },
  ]);
});

test("sumBuckets adds per bucket, empty buckets are 0", () => {
  assert.deepEqual(
    sumBuckets(
      [
        { t: 10, v: 1n },
        { t: 50, v: 2n },
        { t: 250, v: 5n },
      ],
      0,
      200,
      100,
    ),
    [
      { t: 0, v: 3n },
      { t: 100, v: 0n },
      { t: 200, v: 5n },
    ],
  );
});

const pos = (over: Partial<OpenRow>): OpenRow => ({
  user: "0xa",
  instrumentId: 0,
  isLong: true,
  margin: 10n * USD,
  leverage: 100n,
  notional: 1_000n * USD,
  entryPrice: 100n * WAD,
  ...over,
});

test("house exposure: OI by side, leverage mix, shocks and liquidation map", () => {
  const rows = [pos({}), pos({ isLong: false, leverage: 10n, margin: 100n * USD })];
  const e = exposure(rows, 100n * WAD, 0);
  assert.equal(e.longOi, "1000");
  assert.equal(e.shortOi, "1000");
  assert.equal(e.positions, 2);
  assert.equal(e.leverage.find((b) => b.min === 100)!.positions, 1);
  assert.equal(e.leverage.find((b) => b.min === 10)!.positions, 1);
  // Long and short with the same notional: a +1 % move is +10 for the long and −10 for the short, the house nets 0.
  assert.equal(e.shocks.find((s) => s.move === 1)!.houseDelta, "0");
  // +10 %: the long gains 100 but the short loses only its 100 margin: house nets 0 too. −10 %: long loses its 10 margin, short gains 100.
  assert.equal(e.shocks.find((s) => s.move === -10)!.houseDelta, "-90");
  // Long at 100x liquidates at 99, short at 10x at 110: both inside the ±50 % map.
  const liq = e.liquidationMap.filter((b) => b.positions > 0);
  assert.equal(liq.length, 2);
  assert.ok(Number(liq[0]!.from) <= 99 && Number(liq[0]!.to) > 99 && liq[0]!.longNotional === "1000");
  assert.ok(Number(liq[1]!.from) <= 110 && Number(liq[1]!.to) > 110 && liq[1]!.shortNotional === "1000");
  const noPrice = exposure(rows, undefined, 0);
  assert.equal(noPrice.traderUnrealizedPnl, null);
  assert.deepEqual(noPrice.shocks, []);
});
