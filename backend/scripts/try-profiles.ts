/**
 * End-to-end test of profiles against the indexer API on the fork: an EOA and a real ERC-1271 smart wallet claim
 * usernames, another key cannot sign for the smart wallet, a challenge works once, names are unique, and the leaderboard
 * shows the username. Fork only.
 *
 *   pnpm fork · pnpm setup:fork · NETWORK=fork pnpm indexer (and a relayer + pnpm try:cycle for the leaderboard check)
 *   pnpm try:profiles
 *
 * The smart wallet is a minimal ERC-1271 contract (source below), deployed here: valid if its owner signed the hash.
 *   contract Wallet1271 { address public immutable owner; constructor(address o) { owner = o; }
 *     function isValidSignature(bytes32 h, bytes calldata s) external view returns (bytes4) {
 *       ... return ecrecover(h, v, r, ss) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff); } }
 */
import { getNetwork } from "@hm/shared";
import { createWalletClient, encodeAbiParameters, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const api = process.env.INDEXER_URL ?? `http://localhost:${process.env.INDEXER_PORT ?? 8096}`;
const { chain, rpcUrl, client } = getNetwork("fork");
const WALLET_1271_BYTECODE = "0x60a0604052348015600e575f5ffd5b506040516102b53803806102b5833981016040819052602b91603b565b6001600160a01b03166080526066565b5f60208284031215604a575f5ffd5b81516001600160a01b0381168114605f575f5ffd5b9392505050565b6080516102326100835f395f8181606e015260fa01526102325ff3fe608060405234801561000f575f5ffd5b5060043610610034575f3560e01c80631626ba7e146100385780638da5cb5b14610069575b5f5ffd5b61004b610046366004610185565b6100a8565b6040516001600160e01b031990911681526020015b60405180910390f35b6100907f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b039091168152602001610060565b5f604182146100c057506001600160e01b031961017e565b604080515f80825260208083018085528890528684013590911a9282018390528535606083018190529086013560808301819052909290917f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169060019060a0016020604051602081039080840390855afa158015610149573d5f5f3e3d5ffd5b505050602060405103516001600160a01b03161461016f576001600160e01b0319610178565b630b135d3f60e11b5b93505050505b9392505050565b5f5f5f60408486031215610197575f5ffd5b83359250602084013567ffffffffffffffff8111156101b4575f5ffd5b8401601f810186136101c4575f5ffd5b803567ffffffffffffffff8111156101da575f5ffd5b8660208284010111156101eb575f5ffd5b93966020919091019550929350505056fea26469706673582212204e66112186956145189e80f6e15e0445f9f064f6e79d41bbd8846802571683a164736f6c63430008220033" as Hex;

let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✖"} ${label}`);
};
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
type Typed = { domain: never; types: never; primaryType: never; message: Record<string, string> };
const forSigning = (t: Typed) => ({ ...t, message: { ...t.message, expires: BigInt(t.message.expires!) } }) as never;
const suffix = Date.now().toString(36).slice(-5);

async function claim(wallet: Address, username: string, sign: (t: Typed) => Promise<Hex>) {
  const ch = await call("POST", "/api/profile/challenge", { wallet, username });
  if (ch.status !== 200) return { ...ch, body: undefined };
  const signature = await sign(ch.json.typedData as Typed);
  const body = { wallet, username, challengeId: ch.json.challengeId, signature };
  return { ...(await call("PUT", "/api/profile/username", body)), body };
}

// 1. EOA (anvil account 2, the test user)
const [deployer, , user] = (await createWalletClient({ chain, transport: http(rpcUrl) }).getAddresses()) as Address[];
const userWallet = createWalletClient({ account: user!, chain, transport: http(rpcUrl) });
const eoaName = `trader.${suffix}`;
const eoa = await claim(user!, eoaName, (t) => userWallet.signTypedData(forSigning(t)));
check(eoa.status === 200 && eoa.json.username === eoaName, `EOA ${user} claims "${eoaName}" by signing (EIP-712)`);
const byName = await call("GET", `/api/profile/by-username/${eoaName.toUpperCase()}`);
check(byName.json.wallet === user!.toLowerCase(), "/u/<username> resolves the right wallet (case-insensitive)");

// 2. Smart wallet (ERC-1271): deploy, then its owner key signs
const owner = privateKeyToAccount(generatePrivateKey());
const deployerWallet = createWalletClient({ account: deployer!, chain, transport: http(rpcUrl) });
const hash = await deployerWallet.sendTransaction({ data: (WALLET_1271_BYTECODE + encodeAbiParameters([{ type: "address" }], [owner.address]).slice(2)) as Hex });
const smart = (await client.waitForTransactionReceipt({ hash })).contractAddress!;
const smartName = `vault.${suffix}`;
const sc = await claim(smart, smartName, (t) => owner.signTypedData(forSigning(t)));
check(sc.status === 200 && sc.json.wallet === smart.toLowerCase(), `smart wallet ${smart} (ERC-1271) claims "${smartName}"`);

// 3. Another key cannot sign for the smart wallet
const intruder = privateKeyToAccount(generatePrivateKey());
const bad = await claim(smart, `stolen.${suffix}`, (t) => intruder.signTypedData(forSigning(t)));
check(bad.status === 401 && bad.json.code === "INVALID_SIGNATURE", `another key signing for the smart wallet → ${bad.status} ${bad.json.code}`);

// 4. A challenge works only once
const reuse = await call("PUT", "/api/profile/username", eoa.body);
check(reuse.status === 410 && reuse.json.code === "CHALLENGE_EXPIRED", `reusing a challenge → ${reuse.status} ${reuse.json.code}`);

// 5. Unique names
const taken = await call("POST", "/api/profile/challenge", { wallet: smart, username: eoaName });
check(taken.status === 409 && taken.json.code === "USERNAME_TAKEN", `another wallet asking for "${eoaName}" → ${taken.status} ${taken.json.code}`);

// 6. Leaderboard shows the username (if the test user has trades: run try:cycle first)
const board = (await call("GET", "/api/leaderboard?by=volume")).json as unknown as { user: string; username: string | null }[];
const row = board.find((r) => r.user === user!.toLowerCase());
if (row) check(row.username === eoaName, `leaderboard shows "${row.username}" for ${user}`);
else console.log("  (the test user has no trades: run pnpm try:cycle to check the leaderboard)");

process.exit(failures ? 1 : 0);
