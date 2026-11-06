import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";

import { profileRoutes } from "../src/profiles/routes.js";
import { challengeMessage, challengeTypedData, checkUsername, normalizeWallet, verifyChallengeSignature, type Challenge } from "../src/profiles/rules.js";
import { openProfileStore, type ProfileStore } from "../src/profiles/store.js";

const CHAIN = 4663;
const alice = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const bob = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const noContract = { verifyTypedData: async () => false, verifyMessage: async () => false } as never;

test("username rules", () => {
  assert.deepEqual(checkUsername("House.Trader"), { ok: true, username: "house.trader" });
  for (const bad of ["ab", "a".repeat(25), "-abc", "has space", "émoji", "UPPER!"]) assert.equal(checkUsername(bad).ok, false, bad);
  for (const reserved of ["admin", "jacktrade", "jack.trade", "jack_trade.fan", "jacktrade123", "support", "relayer", "0xabcdef12"]) assert.equal(checkUsername(reserved).ok, false, reserved);
  assert.equal(checkUsername(42).ok, false);
});

test("wallets are normalized to lowercase", () => {
  assert.equal(normalizeWallet(alice.address), alice.address.toLowerCase());
  assert.equal(normalizeWallet("0x123"), undefined);
});

const challenge = (): Challenge => ({ wallet: alice.address.toLowerCase() as `0x${string}`, username: "house.trader", nonce: `0x${"11".repeat(32)}`, expiresAt: new Date("2026-10-21T15:10:00.000Z") });

test("EOA: accepts EIP-712 and EIP-191 from the wallet; rejects other signers and altered data", async () => {
  const c = challenge();
  const typed = await alice.signTypedData(challengeTypedData(c, CHAIN));
  const plain = await alice.signMessage({ message: challengeMessage(c, CHAIN) });
  assert.equal(await verifyChallengeSignature(noContract, c, typed, CHAIN), true);
  assert.equal(await verifyChallengeSignature(noContract, c, plain, CHAIN), true);
  assert.equal(await verifyChallengeSignature(noContract, c, await bob.signTypedData(challengeTypedData(c, CHAIN)), CHAIN), false);
  assert.equal(await verifyChallengeSignature(noContract, { ...c, username: "other.name" }, typed, CHAIN), false);
  assert.equal(await verifyChallengeSignature(noContract, c, "0x1234", CHAIN), false);
});

test("smart wallet: falls back to ERC-1271 (isValidSignature) when recovery does not match", async () => {
  const c = challenge();
  const contractSays = { verifyTypedData: async () => true, verifyMessage: async () => false } as never;
  const sig = await bob.signTypedData(challengeTypedData(c, CHAIN)); // a key that is not the wallet
  assert.equal(await verifyChallengeSignature(contractSays, c, sig, CHAIN), true);
});

// ---------------------------------------------------------------- endpoints, against a real (embedded) database

let dir: string;
let store: ProfileStore;
let app: Hono;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "hm-profiles-"));
  store = await openProfileStore({ databaseUrl: "", localDir: dir });
  app = new Hono();
  profileRoutes(app as never, { store, client: noContract, chainId: CHAIN, challengeTtlSeconds: 600, changeCooldownSeconds: 0, limits: { ipBurst: 1000, ipPerSecond: 100, walletBurst: 1000, walletPerSecond: 100 } });
});
after(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

async function claim(account: typeof alice, username: string) {
  const ch = await call("POST", "/api/profile/challenge", { wallet: account.address, username });
  if (ch.status !== 200) return ch;
  const typed = ch.json.typedData as { domain: never; types: never; primaryType: never; message: Record<string, string> };
  const signature = await account.signTypedData({ ...typed, message: { ...typed.message, expires: BigInt(typed.message.expires!) } } as never);
  return call("PUT", "/api/profile/username", { wallet: account.address, username, challengeId: ch.json.challengeId, signature });
}

test("flow: empty profile, claim, read by wallet and by username", async () => {
  assert.deepEqual((await call("GET", `/api/profile/${alice.address}`)).json, { wallet: alice.address.toLowerCase(), username: null, createdAt: null, updatedAt: null });
  const put = await claim(alice, "House.Trader");
  assert.equal(put.status, 200);
  assert.equal(put.json.username, "house.trader");
  assert.equal((await call("GET", `/api/profile/${alice.address.toUpperCase().replace("0X", "0x")}`)).json.username, "house.trader");
  assert.equal((await call("GET", "/api/profile/by-username/HOUSE.trader")).json.wallet, alice.address.toLowerCase());
  assert.equal((await call("GET", "/api/profile/by-username/nobody.here")).json.code, "PROFILE_NOT_FOUND");
});

test("another wallet cannot take the username, nor sign for alice", async () => {
  assert.equal((await call("POST", "/api/profile/challenge", { wallet: bob.address, username: "house.trader" })).json.code, "USERNAME_TAKEN");
  const ch = await call("POST", "/api/profile/challenge", { wallet: alice.address, username: "alice.two" });
  const typed = ch.json.typedData as { message: Record<string, string> };
  const bobSig = await bob.signTypedData({ ...(typed as never as object), message: { ...typed.message, expires: BigInt(typed.message.expires!) } } as never);
  const r = await call("PUT", "/api/profile/username", { wallet: alice.address, username: "alice.two", challengeId: ch.json.challengeId, signature: bobSig });
  assert.equal(r.status, 401);
  assert.equal(r.json.code, "INVALID_SIGNATURE");
});

test("a challenge works once; reusing it is rejected", async () => {
  const ch = await call("POST", "/api/profile/challenge", { wallet: bob.address, username: "bob.one" });
  const typed = ch.json.typedData as { message: Record<string, string> };
  const signature = await bob.signTypedData({ ...(typed as never as object), message: { ...typed.message, expires: BigInt(typed.message.expires!) } } as never);
  const body = { wallet: bob.address, username: "bob.one", challengeId: ch.json.challengeId, signature };
  assert.equal((await call("PUT", "/api/profile/username", body)).status, 200);
  const again = await call("PUT", "/api/profile/username", body);
  assert.equal(again.status, 410);
  assert.equal(again.json.code, "CHALLENGE_EXPIRED");
});

test("a wallet has one username: changing frees the old one", async () => {
  assert.equal((await claim(bob, "bob.two")).status, 200);
  assert.equal((await call("GET", "/api/profile/by-username/bob.one")).status, 404);
  assert.equal((await claim(alice, "bob.one")).status, 200);
});

test("rate limit: too many challenges from the same wallet", async () => {
  const strict = new Hono();
  profileRoutes(strict as never, { store, client: noContract, chainId: CHAIN, challengeTtlSeconds: 600, changeCooldownSeconds: 0, limits: { ipBurst: 100, ipPerSecond: 1, walletBurst: 2, walletPerSecond: 0.001 } });
  const ask = async () => (await strict.request("/api/profile/challenge", { method: "POST", body: JSON.stringify({ wallet: bob.address, username: "bob.three" }) })).status;
  assert.deepEqual([await ask(), await ask(), await ask()], [200, 200, 429]);
});

test("cooldown: a second change too soon is rejected", async () => {
  const slow = new Hono();
  profileRoutes(slow as never, { store, client: noContract, chainId: CHAIN, challengeTtlSeconds: 600, changeCooldownSeconds: 3600, limits: { ipBurst: 100, ipPerSecond: 10, walletBurst: 100, walletPerSecond: 10 } });
  const ch = await slow.request("/api/profile/challenge", { method: "POST", body: JSON.stringify({ wallet: alice.address, username: "alice.new" }) });
  const j = (await ch.json()) as { challengeId: string; typedData: { message: Record<string, string> } };
  const signature = await alice.signTypedData({ ...(j.typedData as never as object), message: { ...j.typedData.message, expires: BigInt(j.typedData.message.expires!) } } as never);
  const r = await slow.request("/api/profile/username", { method: "PUT", body: JSON.stringify({ wallet: alice.address, username: "alice.new", challengeId: j.challengeId, signature }) });
  assert.equal(r.status, 429);
  assert.equal(((await r.json()) as { code: string }).code, "CHANGE_TOO_SOON");
});

test("invalid input gets a clear code", async () => {
  assert.equal((await call("POST", "/api/profile/challenge", { wallet: "nope", username: "x.y.z" })).json.code, "INVALID_REQUEST");
  const reserved = await call("POST", "/api/profile/challenge", { wallet: alice.address, username: "admin" });
  assert.equal(reserved.status, 400);
  assert.equal(reserved.json.code, "INVALID_USERNAME");
});
