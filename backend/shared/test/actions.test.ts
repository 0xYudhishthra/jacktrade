import assert from "node:assert/strict";
import { test } from "node:test";

import { privateKeyToAccount } from "viem/accounts";

import { actionFromJson, actionId, actionToJson, actionTypedData, recoverActionSigner, type Action } from "../src/actions.js";
import { deployment } from "../src/network.js";

const wallet = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const withdraw: Action = { kind: "withdraw", action: { user: wallet.address, to: wallet.address, amount: 10_000_000n, nonce: 7n, deadline: 2_000_000_000n } };

test("ida y vuelta por JSON", () => {
  for (const a of [
    withdraw,
    { kind: "registerSessionKey", action: { user: wallet.address, key: "0x00000000000000000000000000000000000000AA", expiry: 1_900_000_000n, epoch: 0n, nonce: 1n, deadline: 2n } },
    { kind: "stake", action: { user: wallet.address, amount: 1n, nonce: 1n, deadline: 2n } },
    { kind: "claim", action: { user: wallet.address, nonce: 1n, deadline: 2n } },
    { kind: "depositPermit", action: { user: wallet.address, amount: 20_000_000n, nonce: 0n, deadline: 2n } },
  ] as Action[]) {
    assert.deepEqual(actionFromJson(JSON.parse(JSON.stringify(actionToJson(a)))), a);
  }
});

test("rechaza kind desconocido, campos de más o de menos, y números inválidos", () => {
  assert.throws(() => actionFromJson({ kind: "borrar", action: {} } as never), /kind/);
  const j = actionToJson(withdraw) as { action: Record<string, string> };
  assert.throws(() => actionFromJson({ ...j, action: { ...j.action, extra: "1" } } as never), /fields/);
  assert.throws(() => actionFromJson({ ...j, action: { ...j.action, amount: "-1" } } as never), /amount/);
  assert.throws(() => actionFromJson({ ...j, action: { ...j.action, to: "0x123" } } as never), /to/);
  const reg = { kind: "registerSessionKey", action: { user: wallet.address, key: wallet.address, expiry: (2n ** 64n).toString(), epoch: "0", nonce: "1", deadline: "2" } };
  assert.throws(() => actionFromJson(reg as never), /expiry out of range/);
});

test("la firma de la wallet se recupera; el id va todo en minúsculas", async () => {
  const signature = await wallet.signTypedData(actionTypedData(withdraw) as never);
  assert.equal(await recoverActionSigner(withdraw, signature), wallet.address);
  assert.equal(actionId({ kind: "depositPermit", action: { user: wallet.address, amount: 1n, nonce: 3n, deadline: 1n } }), `depositpermit:${wallet.address.toLowerCase()}:3`);
});

test("el permit de USDG es para el Exchange, con el dominio de Global Dollar", () => {
  const td = actionTypedData({ kind: "depositPermit", action: { user: wallet.address, amount: 5n, nonce: 0n, deadline: 9n } });
  assert.equal(td.primaryType, "Permit");
  assert.equal((td.domain as { name: string; version: string }).name, "Global Dollar");
  assert.equal((td.message as { spender: string }).spender.toLowerCase(), deployment.contracts.Exchange.address.toLowerCase());
});
