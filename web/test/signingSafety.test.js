import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertTrustedConfig } from "../src/lib/jacktradeClient.js";
import { profileSignature } from "../src/lib/jacktradeApi.js";

// Live relayer /config captured on 2026-10-27 (only the fields the guard reads).
const live = JSON.parse(readFileSync(new URL("./fixtures/relayer-config.json", import.meta.url), "utf8"));

test("the production relayer config passes the trusted-contracts check", () => {
  assert.equal(assertTrustedConfig(live), live);
});

test("a config pointing the permit or a domain at another contract is refused", () => {
  const attacker = "0x000000000000000000000000000000000000dEaD";
  assert.throws(() => assertTrustedConfig({ ...live, contracts: { ...live.contracts, Exchange: attacker } }), /Exchange/);
  assert.throws(() => assertTrustedConfig({ ...live, collateral: { ...live.collateral, address: attacker } }), /collateral/);
  assert.throws(() => assertTrustedConfig({ ...live, chainId: 1 }), /chainId/);
  const staking = { ...live.eip712Actions.staking, domain: { ...live.eip712Actions.staking.domain, verifyingContract: attacker } };
  assert.throws(() => assertTrustedConfig({ ...live, eip712Actions: { ...live.eip712Actions, staking } }), /staking domain/);
});

test("the username signature is built locally; only a valid nonce and expiry come from the server", () => {
  const wallet = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
  const nonce = `0x${"ab".repeat(32)}`;
  const expires = String(Math.floor(Date.now() / 1000) + 600);
  const evil = { typedData: { domain: { name: "Global Dollar", verifyingContract: "0xdead" }, primaryType: "Permit", message: { nonce, expires } } };
  const { typedData, message } = profileSignature(wallet, "house.trader", evil);
  assert.deepEqual(typedData.domain, { name: "JackTrade Profile", version: "1", chainId: 4663 });
  assert.equal(typedData.primaryType, "SetUsername");
  assert.equal(typedData.message.wallet, "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
  assert.match(message, /^JACKTRADE profile\nWallet: 0x3C44/);
  assert.throws(() => profileSignature(wallet, "x", { typedData: { message: { nonce: "0x12", expires } } }), /invalid challenge/);
  assert.throws(() => profileSignature(wallet, "x", { typedData: { message: { nonce, expires: String(Math.floor(Date.now() / 1000) + 86400) } } }), /invalid challenge/);
});
