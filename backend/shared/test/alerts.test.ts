import assert from "node:assert/strict";
import { test } from "node:test";

import { createAlertTracker, telegramSender } from "../src/alerts.js";
import { redact } from "../src/errors.js";

function setup() {
  let t = 0;
  const sent: string[] = [];
  const tracker = createAlertTracker("relayer", { send: async (m) => (sent.push(m), true), afterMs: 60_000, repeatMs: 3_600_000, now: () => t });
  return { tracker, sent, at: (ms: number) => (t = ms) };
}

test("un problema avisa recién si dura el mínimo, y una sola vez", async () => {
  const { tracker, sent, at } = setup();
  await tracker.report(["poco ETH (0.001)"]);
  at(30_000);
  await tracker.report(["poco ETH (0.001)"]);
  assert.equal(sent.length, 0);
  at(60_000);
  await tracker.report(["poco ETH (0.0009)"]); // mismo problema aunque cambie el número
  at(70_000);
  await tracker.report(["poco ETH (0.0009)"]);
  assert.equal(sent.length, 1);
  assert.match(sent[0]!, /\[relayer · .*\]\n🔴 poco ETH \(0\.0009\)/);
});

test("lo que dura menos que el mínimo no avisa ni manda resuelto", async () => {
  const { tracker, sent, at } = setup();
  await tracker.report(["precio de BTC/USD atrasado"]);
  at(10_000);
  await tracker.report([]);
  assert.deepEqual(sent, []);
});

test("recordatorio cada hora y resuelto al final", async () => {
  const { tracker, sent, at } = setup();
  await tracker.report(["sin rol"]);
  at(60_000);
  await tracker.report(["sin rol"]);
  at(60_000 + 3_600_000);
  await tracker.report(["sin rol"]);
  at(60_000 + 3_700_000);
  await tracker.report([]);
  assert.equal(sent.length, 3);
  assert.match(sent[1]!, /🟠 sigue: sin rol/);
  assert.match(sent[2]!, /🟢 resuelto: sin rol/);
});

test("varios cambios en un chequeo van en un solo mensaje", async () => {
  const { tracker, sent, at } = setup();
  await tracker.report(["a", "b"]);
  at(60_000);
  await tracker.report(["a", "b"]);
  assert.equal(sent.length, 1);
  assert.match(sent[0]!, /🔴 a\n🔴 b/);
});

test("sin token o chat no hay envío; el token del bot se tapa en los logs", () => {
  assert.equal(telegramSender({ token: "", chatId: "1" }), undefined);
  assert.equal(telegramSender({ token: "123:abc", chatId: undefined }), undefined);
  assert.equal(redact("fetch failed https://api.telegram.org/bot1234567890:AAH-abcdefghijklmnopqrstuvwxyz/sendMessage"), "fetch failed https://api.telegram.org/bot<redactado>/sendMessage");
});

test("manda el texto como JSON al chat configurado", async () => {
  const calls: { url: string; body: { chat_id: string; text: string } }[] = [];
  const send = telegramSender({
    token: "1234567890:AAH-abcdefghijklmnopqrstuvwxyz",
    chatId: "-100123",
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  })!;
  await send("hola");
  assert.equal(calls[0]!.body.chat_id, "-100123");
  assert.equal(calls[0]!.body.text, "hola");
  assert.match(calls[0]!.url, /\/bot1234567890:.*\/sendMessage$/);
});

test("hashes de tx distintos son el mismo problema", async () => {
  const { tracker, sent, at } = setup();
  await tracker.report(["error reciente: harvest revirtió (tx 0xab12cd)"]);
  at(60_000);
  await tracker.report(["error reciente: harvest revirtió (tx 0xff9900)"]);
  assert.equal(sent.length, 1);
});

test("si Telegram falla, se reintenta en el próximo chequeo (también el resuelto)", async () => {
  let t = 0;
  let ok = false;
  const sent: string[] = [];
  const tracker = createAlertTracker("keepers", { send: async (m) => (sent.push(m), ok), afterMs: 0, repeatMs: 3_600_000, now: () => t });
  await tracker.report(["sin rol"]); // falla
  t = 10_000;
  ok = true;
  await tracker.report(["sin rol"]); // se reintenta el 🔴, no espera una hora
  assert.match(sent[1]!, /🔴 sin rol/);
  ok = false;
  t = 20_000;
  await tracker.report([]); // el resuelto falla
  ok = true;
  t = 30_000;
  await tracker.report([]);
  assert.match(sent.at(-1)!, /🟢 resuelto: sin rol/);
});
