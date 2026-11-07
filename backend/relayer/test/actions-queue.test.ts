import assert from "node:assert/strict";
import { test } from "node:test";

import type { Action } from "@hm/shared";

import { ActionQueue } from "../src/actions.js";

const user = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const claim = (nonce: bigint): Action => ({ kind: "claim", action: { user, nonce, deadline: 9_999_999_999n } });
const sig = "0x" as const;

test("reserva: la misma acción dos veces a la vez, la segunda se rechaza", () => {
  const q = new ActionQueue();
  assert.equal(q.reserve("claim:x:1", user), true);
  assert.equal(q.reserve("claim:x:1", user), false);
  q.release("claim:x:1");
  assert.equal(q.reserve("claim:x:1", user), true);
});

test("reserva: después de encolada o ejecutada no se puede volver a mandar; si falló, sí", () => {
  const q = new ActionQueue();
  const a = q.add(claim(1n), sig);
  assert.equal(q.reserve(a.id, user), false);
  q.setStatus({ id: a.id, status: "failed", code: "Unknown", message: "x" });
  assert.equal(q.reserve(a.id, user), true);
});

test("un estado executed no se pisa con failed", () => {
  const q = new ActionQueue();
  const a = q.add(claim(2n), sig);
  q.setStatus({ id: a.id, status: "executed", txHash: "0x01" });
  q.setStatus({ id: a.id, status: "failed", code: "Unknown", message: "copia tardía" });
  assert.equal(q.status(a.id)?.status, "executed");
});

test("pendientes por usuario cuentan la fila y lo mandado sin recibo; cuota diaria", () => {
  const q = new ActionQueue();
  const a = q.add(claim(3n), sig);
  q.add(claim(4n), sig);
  assert.equal(q.pendingOf(user), 2);
  q.take();
  q.markInFlight(a.id, user);
  assert.equal(q.pendingOf(user), 2);
  q.settled(a.id);
  assert.equal(q.pendingOf(user), 1);
  assert.equal(q.usedToday(user), 2);
  assert.equal(q.usedToday("0x0000000000000000000000000000000000000001"), 0);
});

test("un retiro en fila reserva balance y nonce del Exchange", () => {
  const q = new ActionQueue();
  q.add({ kind: "withdraw", action: { user, to: user, amount: 5n, nonce: 9n, deadline: 1n } }, sig);
  assert.equal(q.reservedWithdraw(user), 5n);
  assert.equal(q.hasExchangeNonce(user, 9n), true);
  assert.equal(q.hasExchangeNonce(user, 8n), false);
});

test("las que se están validando cuentan para el tope del usuario (pedidos simultáneos)", () => {
  const q = new ActionQueue();
  q.reserve("claim:u:1", user);
  q.reserve("claim:u:2", user);
  assert.equal(q.pendingOf(user, "claim:u:3"), 2);
  assert.equal(q.pendingOf(user, "claim:u:1"), 1); // la propia no cuenta
  assert.equal(q.usedToday(user, "claim:u:3"), 2);
});
