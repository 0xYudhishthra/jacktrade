// Live Definitive Flash test: the exact "Make it real" flow from web/src/routes/real.jsx, run
// from a script with a test wallet. Buys a small amount of the real TSLA stock token on
// Robinhood Chain with a market order and an attached take-profit / stop-loss bracket.
//
//   set -a; . ../test-wallet.keys.env; set +a
//   node test/flash.live.ts 0.5        # spend 0.5 USDG
import { createPublicClient, createWalletClient, defineChain, erc20Abi, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const APP = process.env.CONNECTOR_URL ?? "https://jacktrade.up.railway.app";
const RPC = process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const TSLA = "0x322F0929c4625eD5bAd873c95208D54E1c003b2d";

const key = process.env.TEST_WALLET_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("TEST_WALLET_PRIVATE_KEY is not set (source test-wallet.keys.env)");
const account = privateKeyToAccount(key);
const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nonEmpty = (v: unknown) => v !== null && v !== undefined && v !== "";

async function api(path: string, body?: unknown) {
  const res = await fetch(`${APP}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(json)}`);
  return json as any;
}

async function sendTx(tx: { to: Hex; data: Hex; value?: string }, label: string) {
  const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`${label}: ${hash} (${r.status})`);
}

async function signJson(typedDataJson: string) {
  const parsed = JSON.parse(typedDataJson);
  const types = { ...(parsed.types || {}) };
  delete types.EIP712Domain;
  const domain = { ...parsed.domain };
  if (domain.chainId !== undefined) domain.chainId = Number(domain.chainId);
  return account.signTypedData({ domain, types, primaryType: parsed.primaryType, message: parsed.message });
}

const qty = process.argv[2] ?? "0.5";
const base = { targetChain: "robinhood", contraChain: "robinhood", targetAsset: TSLA, contraAsset: USDG, side: "buy", qty, orderType: "market", funderAddress: account.address };

const probe = await api("/api/flash/quote", base);
const price = Number(qty) / Number(probe.to.amount);
const tp = (price * 1.1).toFixed(2);
const sl = (price * 0.9).toFixed(2);
console.log(`wallet ${account.address}\nTSLA token ≈ $${price.toFixed(2)} → take-profit $${tp}, stop-loss $${sl}`);

const body = { ...base, attachedBracket: { takeProfit: { notionalPrice: tp }, stopLoss: { notionalPrice: sl } } };
let q = await api("/api/flash/quote", body);
let sent = false;
if (q.evm?.approveTx) { await sendTx(q.evm.approveTx, "approve USDG for Flash"); sent = true; }
if (q.attachedBracket?.evm?.approveTx) { await sendTx(q.attachedBracket.evm.approveTx, "approve TSLA for the exits"); sent = true; }
if (sent) {
  await sleep(2500);
  q = await api("/api/flash/quote", body);
}
if (!nonEmpty(q.attachedBracket?.evm?.orderTypedData)) throw new Error("no bracket payload; refusing an unprotected order");

const permit = nonEmpty(q.evm.permitTypedData) ? { evmPermitTypedData: q.evm.permitTypedData, evmPermitSignature: await signJson(q.evm.permitTypedData) } : {};
const userSignature = await signJson(q.evm.orderTypedData);
const bracketPermit = nonEmpty(q.attachedBracket.evm.permitTypedData)
  ? { evmPermitTypedData: q.attachedBracket.evm.permitTypedData, evmPermitSignature: await signJson(q.attachedBracket.evm.permitTypedData) }
  : {};
const bracketSig = await signJson(q.attachedBracket.evm.orderTypedData);

const order = await api("/api/flash/order", {
  ...body,
  targetAsset: q.targetAsset || body.targetAsset,
  contraAsset: q.contraAsset || body.contraAsset,
  quoteId: q.quoteId,
  userSignature,
  evmOrderTypedData: q.evm.orderTypedData,
  ...permit,
  attachedBracket: { ...body.attachedBracket, userSignature: bracketSig, salt: q.attachedBracket.salt, deadline: q.attachedBracket.deadline, signedMaxFromAmount: q.attachedBracket.signedMaxFromAmount, ...bracketPermit },
});
console.log("order:", JSON.stringify(order));

for (let i = 0; i < 40; i++) {
  await sleep(3000);
  const d = await api(`/api/flash/orders/${order.orderId}?wallet=${account.address}`).catch((e) => ({ error: String(e) }));
  const status = d.status ?? d.order?.status;
  if (i % 3 === 0 || /FILLED|CANCEL|FAIL|EXPIRED/i.test(String(status))) console.log(`status: ${status}`, JSON.stringify(d.fills ?? d.order?.fills ?? "").slice(0, 300));
  if (/FILLED|CANCEL|FAIL|EXPIRED/i.test(String(status))) break;
}
const bal = await pub.readContract({ address: TSLA, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
console.log(`wallet TSLA token balance: ${Number(bal) / 1e18}`);
