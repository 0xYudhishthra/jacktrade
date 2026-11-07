import assert from "node:assert/strict";
import { test } from "node:test";

import { PYTH_OPEN_SECONDS, previewQuote, previousCloseFrom } from "../src/preview.js";

const pyth = { feedId: "0x16" as const, price: 39565747000n, conf: 9758000n, expo: -8, publishTime: 1000, updateData: "0x" as const };

test("preview quote: Pyth price, open while Pyth keeps publishing, nothing without a price", () => {
  const q = previewQuote(pyth, 391.62, 1010)!;
  assert.equal(q.source, "pyth");
  assert.equal(q.price, "39565747000");
  assert.equal(q.conf, "9758000");
  assert.equal(q.publishTime, 1000);
  assert.ok(Math.abs(q.usd - 395.65747) < 1e-9);
  assert.equal(q.previousClose, 391.62);
  assert.equal(q.marketOpen, true);
  assert.equal(previewQuote(pyth, null, 1000 + PYTH_OPEN_SECONDS + 1)!.marketOpen, false);
  assert.equal(previewQuote(undefined, 391.62), null);
});

test("previous close: last daily candle before today (UTC)", () => {
  const day = 86_400;
  const candles = [
    { t: 10 * day, o: 1, h: 1, l: 1, c: 370 },
    { t: 11 * day, o: 1, h: 1, l: 1, c: 391.62 },
    { t: 12 * day, o: 1, h: 1, l: 1, c: 395.6 },
  ];
  assert.equal(previousCloseFrom(candles, 12 * day + 3600), 391.62);
  assert.equal(previousCloseFrom(candles, 13 * day + 3600), 395.6); // no candle yet today
  assert.equal(previousCloseFrom([], 12 * day), null);
});
