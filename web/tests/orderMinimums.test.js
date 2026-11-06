import { test } from "node:test";
import assert from "node:assert/strict";
import { orderMinimumIssue, orderMinimums } from "../src/lib/orderMinimums.js";

test("10 USDG margin needs 100× for a 1,000 USDG position", () => {
  assert.deepEqual(orderMinimumIssue(10, 10), { kind: "position", minimum: 1000 });
  assert.deepEqual(orderMinimumIssue(10, 90), { kind: "position", minimum: 1000 });
  assert.equal(orderMinimumIssue(10, 100), null);
  assert.equal(orderMinimumIssue(100, 10), null);
  assert.deepEqual(orderMinimumIssue(9.99, 1000), { kind: "margin", minimum: 10 });
});

test("stricter market limits take precedence over frontend minimums", () => {
  const market = { minMargin: "25", minNotional: "2500" };
  assert.deepEqual(orderMinimums(market), { margin: 25, positionSize: 2500, maxPositionSize: null });
  assert.deepEqual(orderMinimumIssue(20, 100, market), { kind: "margin", minimum: 25 });
  assert.deepEqual(orderMinimumIssue(25, 50, market), { kind: "position", minimum: 2500 });
  assert.equal(orderMinimumIssue(25, 100, market), null);
});

test("positions above the market's maximum notional are rejected", () => {
  const market = { minMargin: "10", minNotional: "1000", maxNotional: "100000" };
  assert.equal(orderMinimumIssue(100, 1000, market), null);
  assert.deepEqual(orderMinimumIssue(101, 1000, market), { kind: "maxPosition", maximum: 100000 });
});
