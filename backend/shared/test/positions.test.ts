import assert from "node:assert/strict";
import { test } from "node:test";

import { isLiquidatable, liquidationPrice, pythToWad } from "../src/positions.js";

const WAD = 10n ** 18n;
const pos = (leverage: bigint, isLong = true) => ({ entryPrice: 100n * WAD, leverage, isLong });

test("100x long con 5 bps de buffer: se liquida a 99,05", () => {
  assert.equal(liquidationPrice(pos(100n), 5), 9905n * WAD / 100n);
});

test("1000x: el buffer se come la mitad del margen (disparo a 0,05% en vez de 0,1%)", () => {
  assert.equal(liquidationPrice(pos(1000n), 5), 9995n * WAD / 100n);
  assert.equal(liquidationPrice(pos(1000n, false), 5), 10005n * WAD / 100n);
});

test("si el buffer supera la distancia a equity cero, se liquida en la entrada (igual que main)", () => {
  assert.equal(liquidationPrice(pos(1000n), 15), 100n * WAD);
});

test("isLiquidatable incluye el precio exacto del disparo", () => {
  const p = pos(100n);
  assert.equal(isLiquidatable(p, 5, liquidationPrice(p, 5)), true);
  assert.equal(isLiquidatable(p, 5, liquidationPrice(p, 5) + 1n), false);
});

test("pythToWad como PriceOracle._toWad", () => {
  assert.equal(pythToWad(8_171_003_006_025n, -8), 81_710_030_060_250_000_000_000n);
  assert.throws(() => pythToWad(1n, 1));
});
