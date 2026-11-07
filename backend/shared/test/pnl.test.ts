import assert from "node:assert/strict";
import { test } from "node:test";

import { payout } from "../src/pnl.js";

const fees = { winFeeBps: 200, lossFeeBps: 200 };
const USD = 1_000_000n;

test("gana con la fila vacía y caja: cobra todo, menos el 2%", () => {
  const r = payout({ margin: 20n * USD, gain: 10n * USD, loss: 0n, fees, queueEmpty: true, lpCash: 100n * USD });
  assert.deepEqual(r, { fee: 200_000n, payout: 9_800_000n, paidNow: 9_800_000n, queued: 0n, returned: 29_800_000n });
});

test("gana sin caja suficiente: lo que falta va a la fila", () => {
  const r = payout({ margin: 20n * USD, gain: 10n * USD, loss: 0n, fees, queueEmpty: true, lpCash: 3n * USD });
  assert.equal(r.paidNow, 3n * USD);
  assert.equal(r.queued, 6_800_000n);
  assert.equal(r.returned, 23n * USD);
});

test("gana con fila: todo a la fila, aunque haya caja", () => {
  const r = payout({ margin: 20n * USD, gain: 10n * USD, loss: 0n, fees, queueEmpty: false, lpCash: 100n * USD });
  assert.equal(r.paidNow, 0n);
  assert.equal(r.queued, 9_800_000n);
});

test("pierde: la fee es parte de la pérdida y con fila no se cobra", () => {
  assert.deepEqual(payout({ margin: 20n * USD, gain: 0n, loss: 5n * USD, fees, queueEmpty: true, lpCash: 0n }), { fee: 100_000n, payout: 0n, paidNow: 0n, queued: 0n, returned: 15n * USD });
  assert.equal(payout({ margin: 20n * USD, gain: 0n, loss: 5n * USD, fees, queueEmpty: false, lpCash: 0n }).fee, 0n);
});
