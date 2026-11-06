import assert from "node:assert/strict";
import { test } from "node:test";

import { createCandleSource, MAX_CANDLES, parseHistoryQuery, toCandles, UpstreamBusy } from "../src/history.js";

const NOW = 1_792_360_000;
const parse = (q: string) => parseHistoryQuery(new URLSearchParams(q), [0, 1], NOW);

test("velas: to por defecto es ahora, alineado al cierre de la vela abierta", () => {
  // 15m = 900 s. from ya está alineado; to (ahora) sube al próximo múltiplo de 900.
  assert.deepEqual(parse("market=0&interval=15m&from=1792350000"), { kind: "candles", market: 0, interval: "15m", from: 1_792_350_000, to: 1_792_360_800 });
});

test("velas: como mucho 500, se quedan las más nuevas", () => {
  const q = parse("market=1&interval=1m&from=0");
  assert.ok(q.kind === "candles" && q.to - q.from === MAX_CANDLES * 60);
});

test("velas: el rango se alinea a la grilla y to no pasa de la vela abierta", () => {
  const a = parse("market=0&interval=1h&from=1792300001&to=1792355555");
  const b = parse("market=0&interval=1h&from=1792300002&to=1792355556");
  assert.deepEqual(a, b); // pedidos casi iguales caen en la misma clave de caché
  const far = parse("market=0&interval=1h&from=1792300000&to=9999999999");
  assert.ok(far.kind === "candles" && far.to <= NOW + 2 * 3600);
});

test("ticks: como mucho los últimos 300 s", () => {
  assert.deepEqual(parse("market=0&interval=tick&from=0"), { kind: "ticks", market: 0, from: NOW - 300 });
  assert.deepEqual(parse(`market=0&interval=tick&from=${NOW - 60}`), { kind: "ticks", market: 0, from: NOW - 60 });
});

test("rechaza parámetros inválidos", () => {
  assert.throws(() => parse("market=7&interval=1m&from=1"), /market/);
  assert.throws(() => parse("market=0&interval=2m&from=1"), /interval/);
  assert.throws(() => parse("market=0&interval=1m"), /from/);
  assert.throws(() => parse("market=0&interval=1m&from=100&to=50"), /to/);
});

test("columnas de Pyth a velas ordenadas, dentro del rango", () => {
  const pyth = { s: "ok", t: [120, 60, 0], o: [3, 2, 1], h: [3, 2, 1], l: [3, 2, 1], c: [3, 2, 1] };
  assert.deepEqual(toCandles(pyth, 60, 120, 60).map((c) => c.t), [60, 120]);
  assert.deepEqual(toCandles(pyth, 30, 120, 60).map((c) => c.t), [0, 60, 120]); // la vela de 0 cubre hasta 60
});

test("sin datos devuelve lista vacía; error de Pyth tira", () => {
  assert.deepEqual(toCandles({ s: "no_data" }, 0, 100, 60), []);
  assert.throws(() => toCandles({ s: "error", errmsg: "malo" }, 0, 100, 60), /malo/);
});

test("tope global de pedidos a Pyth: lo que está en caché no cuenta; lo demás se corta con UpstreamBusy", async () => {
  let t = 0;
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ s: "no_data" }), { status: 200 });
  }) as typeof fetch;
  try {
    const candles = createCandleSource({ url: "http://x", apiKey: "k", burst: 2, maxPerSecond: 1, now: () => t });
    await candles("Crypto.BTC/USD", "1m", 0, 600);
    await candles("Crypto.BTC/USD", "1m", 0, 600); // caché: no gasta
    await candles("Crypto.BTC/USD", "1m", 600, 1200);
    await assert.rejects(candles("Crypto.BTC/USD", "1m", 1200, 1800), UpstreamBusy);
    t = 1000; // se repone 1 por segundo
    await candles("Crypto.BTC/USD", "1m", 1200, 1800);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});
