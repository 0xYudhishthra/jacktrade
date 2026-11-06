import assert from "node:assert/strict";
import { test } from "node:test";

import { PositionBook } from "../src/book.js";

const WAD = 10n ** 18n;
const pos = (id: bigint, instrumentId = 0, leverage = 100n) => ({
  id,
  user: "0x0000000000000000000000000000000000000001" as const,
  instrumentId,
  isLong: true,
  margin: 10_000_000n,
  leverage,
  entryPrice: 100n * WAD,
});

test("abre con el precio de liquidación del buffer del mercado y saca al cerrar", () => {
  const book = new PositionBook();
  book.setBuffer(0, 5);
  book.open(pos(1n), 10n);
  assert.equal(book.get(1n)?.liquidationPrice, (9905n * WAD) / 100n);
  assert.equal(book.remove(1n), true);
  assert.equal(book.remove(1n), false);
  assert.equal(book.size, 0);
});

test("si cambia el buffer del mercado, recalcula solo las de ese mercado", () => {
  const book = new PositionBook();
  book.setBuffer(0, 5);
  book.setBuffer(1, 5);
  book.open(pos(1n, 0), 10n);
  book.open(pos(2n, 1), 10n);
  book.setBuffer(0, 10);
  assert.equal(book.get(1n)?.liquidationPrice, (991n * WAD) / 10n);
  assert.equal(book.get(2n)?.liquidationPrice, (9905n * WAD) / 100n);
});

test("sin buffer conocido para el mercado, no adivina", () => {
  assert.throws(() => new PositionBook().open(pos(1n, 3), 10n), /liqBufferBps/);
});

test("crossed: longs que cruzaron hacia abajo y shorts hacia arriba, las más pasadas primero", () => {
  const book = new PositionBook();
  book.setBuffer(0, 5);
  // longs a 100: 10x liquida en 90,05 · 50x en 98,05 · 100x en 99,05
  book.open({ ...pos(1n, 0, 10n) }, 1n);
  book.open({ ...pos(2n, 0, 50n) }, 1n);
  book.open({ ...pos(3n, 0, 100n) }, 1n);
  // short 100x a 100: liquida en 100,95
  book.open({ ...pos(4n, 0, 100n), isLong: false }, 1n);

  const ids = (price: bigint) => book.crossed(0, price).map((p) => p.id);
  assert.deepEqual(ids(100n * WAD), []);
  assert.deepEqual(ids((9905n * WAD) / 100n), [3n]); // justo en el disparo cuenta
  assert.deepEqual(ids(95n * WAD), [3n, 2n]);
  assert.deepEqual(ids(80n * WAD), [3n, 2n, 1n]);
  assert.deepEqual(ids(101n * WAD), [4n]);
});

test("crossed se actualiza al abrir, cerrar y cambiar el buffer", () => {
  const book = new PositionBook();
  book.setBuffer(0, 5);
  book.open(pos(1n, 0, 100n), 1n);
  assert.deepEqual(book.crossed(0, 99n * WAD).map((p) => p.id), [1n]);
  book.remove(1n);
  assert.deepEqual(book.crossed(0, 99n * WAD), []);
  book.open(pos(2n, 0, 100n), 1n);
  assert.deepEqual(book.crossed(0, (991n * WAD) / 10n), []); // 99,1: con 5 bps todavía no (liquida en 99,05)
  book.setBuffer(0, 10); // con 10 bps liquida en 99,1
  assert.deepEqual(book.crossed(0, (991n * WAD) / 10n).map((p) => p.id), [2n]);
});

test("crossed con miles de posiciones es rápido", () => {
  const book = new PositionBook();
  book.setBuffer(0, 5);
  for (let i = 1n; i <= 10_000n; i++) book.open({ ...pos(i, 0, 1n + (i % 1000n)), isLong: i % 2n === 0n }, 1n);
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) book.crossed(0, (99n + BigInt(i % 3)) * WAD);
  assert.ok(performance.now() - t0 < 500, `100 consultas sobre 10.000 posiciones tardaron ${performance.now() - t0} ms`);
});
