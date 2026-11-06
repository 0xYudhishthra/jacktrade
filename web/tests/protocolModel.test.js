import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVERAGE, liquidationPrice, bpsPercent } from "../src/lib/protocolModel.js";

test("leverage control: 10× floor in 10× steps", () => {
  assert.deepEqual(LEVERAGE, { min: 10, step: 10, default: 50 });
});
test("liquidation price uses the market's buffer from the backend", () => {
  // Matches GET /api/positions: short 1000× at 79,795.32315468 with 5 bps liquidates at ≈ 79,835.2208.
  assert.ok(Math.abs(liquidationPrice("short", 79795.32315468, 1000, 5) - 79835.22081625734) < 1e-6);
  assert.equal(liquidationPrice("long", 100, 100, 0), 99);
  assert.equal(liquidationPrice("long", 100, 100, null), null);
  assert.equal(liquidationPrice("long", undefined, 100, 5), null);
});

test("fees in bps read as percentages", () => {
  assert.equal(bpsPercent(200), "2%");
  assert.equal(bpsPercent(15), "0.15%");
  assert.equal(bpsPercent(null), null);
});
