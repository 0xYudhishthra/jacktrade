import assert from "node:assert/strict";
import { test } from "node:test";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { intentFromJson, intentToJson, intentTypedData, recoverIntentSigner, type Intent } from "../src/intents.js";

const wallet = privateKeyToAccount(generatePrivateKey());
const open: Intent = {
  kind: "open",
  intent: {
    user: wallet.address,
    instrumentId: 0,
    isLong: true,
    margin: 10_000_000n,
    leverage: 100n,
    priceLimit: 82_000n * 10n ** 18n,
    signedAt: 1_792_294_301n,
    nonce: 7n,
  },
};

test("recupera la wallet que firmó un open", async () => {
  const signature = await wallet.signTypedData(intentTypedData(open));
  assert.equal(await recoverIntentSigner(open, signature), wallet.address);
});

test("una session key firma por el usuario y se recupera la session key", async () => {
  const sessionKey = privateKeyToAccount(generatePrivateKey());
  const close: Intent = {
    kind: "close",
    intent: { user: wallet.address, positionId: 3n, priceLimit: 0n, signedAt: 1_792_294_301n, nonce: 8n },
  };
  const signature = await sessionKey.signTypedData(intentTypedData(close));
  assert.equal(await recoverIntentSigner(close, signature), sessionKey.address);
});

test("JSON ida y vuelta sin perder precisión", () => {
  const json = intentToJson(open);
  assert.equal(json.intent.priceLimit, "82000000000000000000000");
  assert.deepEqual(intentFromJson(JSON.parse(JSON.stringify(json))), open);
});

test("rechaza JSON con campos faltantes o números inválidos", () => {
  const json = intentToJson(open);
  const { nonce: _, ...missing } = json.intent as Record<string, unknown>;
  assert.throws(() => intentFromJson({ kind: "open", intent: missing } as never));
  assert.throws(() => intentFromJson({ kind: "open", intent: { ...json.intent, margin: "1.5" } } as never));
});

test("intentFromJson rechaza tipos y rangos inválidos (venía de un cliente no confiable)", () => {
  const ok = intentToJson(open);
  const bad = (patch: Record<string, unknown>) => () => intentFromJson({ kind: "open", intent: { ...ok.intent, ...patch } } as never);
  assert.throws(bad({ user: 1 }), /user/);
  assert.throws(bad({ user: "0x123" }), /user/);
  assert.throws(bad({ instrumentId: "0" }), /instrumentId/);
  assert.throws(bad({ instrumentId: -1 }), /instrumentId/);
  assert.throws(bad({ instrumentId: 2 ** 32 }), /instrumentId/);
  assert.throws(bad({ isLong: "true" }), /isLong/);
  assert.throws(bad({ margin: "1".repeat(79) }), /margin/);
  assert.throws(bad({ margin: (2n ** 256n).toString() }), /out of range/);
  assert.throws(() => intentFromJson({ kind: "open", intent: null } as never), /object/);
  assert.throws(() => intentFromJson({ kind: "nada", intent: ok.intent } as never), /kind/);
  assert.throws(() => intentFromJson(null as never), /kind/);
});

test("intentFromJson normaliza la dirección (checksum)", () => {
  const ok = intentToJson(open);
  const lower = intentFromJson({ kind: "open", intent: { ...ok.intent, user: ok.intent.user.toLowerCase() } } as never);
  assert.equal(lower.intent.user, wallet.address);
});
