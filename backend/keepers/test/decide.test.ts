import assert from "node:assert/strict";
import { test } from "node:test";

import { harvestDue, heartbeatPlan, stakerFeesPlan } from "../src/decide.js";

const H = 3600n;

test("heartbeat: con escapeDelay de 24 h y margen de 4 h, toca a las 20 h", () => {
  const base = { lastActivity: 1_000n, escapeDelay: 24n * H, margin: 4n * H };
  assert.equal(heartbeatPlan({ ...base, now: 1_000n + 20n * H - 1n }).due, false);
  const at20 = heartbeatPlan({ ...base, now: 1_000n + 20n * H });
  assert.equal(at20.due, true);
  assert.equal(at20.open, false);
  assert.equal(at20.remaining, 4n * H);
});

test("heartbeat: el escape hatch abre recién después del vencimiento (el contrato usa <=)", () => {
  const base = { lastActivity: 0n, escapeDelay: 24n * H, margin: 4n * H };
  assert.equal(heartbeatPlan({ ...base, now: 24n * H }).open, false);
  assert.equal(heartbeatPlan({ ...base, now: 24n * H + 1n }).open, true);
});

test("heartbeat: con un escapeDelay corto, el margen se limita a la mitad del plazo", () => {
  const p = heartbeatPlan({ now: 0n, lastActivity: 0n, escapeDelay: H, margin: 4n * H });
  assert.equal(p.due, false);
  assert.equal(p.sendAt, H / 2n);
});

test("harvest: solo con fila y caja para la próxima entrada o el mínimo", () => {
  const base = { head: 3n, tail: 5n, sideBucket: 0n, lpCash: 0n, nextOwed: 50_000_000n, minPay: 1_000_000n };
  assert.equal(harvestDue({ ...base, head: 5n, sideBucket: 9_000_000n }), false); // sin fila
  assert.equal(harvestDue(base), false); // sin caja
  assert.equal(harvestDue({ ...base, sideBucket: 500_000n }), false); // menos que el mínimo
  assert.equal(harvestDue({ ...base, sideBucket: 600_000n, lpCash: 400_000n }), true); // suma el mínimo
  assert.equal(harvestDue({ ...base, nextOwed: 200_000n, sideBucket: 200_000n }), true); // paga la entrada entera
});

const U = 1_000_000n;
const fees = { queueEmpty: true, trackedLp: 0n, cap: 5_000_000n * U, lpCash: 0n, minPush: 5n * U, maxIntervalMs: 86_400_000, nowMs: 100_000_000 };

test("pushStakerFees: manda al llegar al mínimo, no por centavos", () => {
  assert.equal(stakerFeesPlan({ ...fees, accrued: 4n * U, lastPushAt: 99_000_000 }).due, false);
  assert.equal(stakerFeesPlan({ ...fees, accrued: 5n * U, lastPushAt: 99_000_000 }).due, true);
});

test("pushStakerFees: con algo acumulado, una vez por día aunque no llegue al mínimo", () => {
  assert.equal(stakerFeesPlan({ ...fees, accrued: 1n, lastPushAt: fees.nowMs - 86_400_000 }).due, true);
  assert.equal(stakerFeesPlan({ ...fees, accrued: 0n, lastPushAt: 0 }).due, false); // nada que mandar
});

test("pushStakerFees: la caja sobre el cap cuenta solo sin fila y como mucho lpCash", () => {
  const over = { ...fees, accrued: 0n, trackedLp: fees.cap + 10n * U, lpCash: 3n * U, lastPushAt: fees.nowMs };
  assert.deepEqual(stakerFeesPlan(over), { accrued: 0n, excess: 3n * U, total: 3n * U, due: false });
  assert.equal(stakerFeesPlan({ ...over, lpCash: 20n * U }).excess, 10n * U);
  assert.equal(stakerFeesPlan({ ...over, lpCash: 20n * U }).due, true);
  assert.equal(stakerFeesPlan({ ...over, lpCash: 20n * U, queueEmpty: false }).excess, 0n);
});
