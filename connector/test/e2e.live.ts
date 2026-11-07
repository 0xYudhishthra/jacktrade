// Live end-to-end test against Robinhood Chain mainnet, the JackTrade backend and the hosted
// connector. It drives exactly what the web app and Grok do: a gasless USDG deposit, Connect
// Grok (agent key registration), then the MCP tools Grok calls. Real funds; small sizes.
//
//   set -a; . ../test-wallet.keys.env; set +a
//   node test/e2e.live.ts deposit 5       # gasless permit deposit of 5 USDG
//   node test/e2e.live.ts connect         # register Grok's key, print the MCP URL (saved to tmp/)
//   node test/e2e.live.ts bet             # house_status → quote → place_bet → my_bets → cash_out
//   node test/e2e.live.ts liquidation     # $1 BTC at 1000x, wait for the liquidator
//   node test/e2e.live.ts tools <name> [json-args]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, defineChain, http, parseAbi, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CONNECTOR = process.env.CONNECTOR_URL ?? "https://jacktrade.up.railway.app";
const RELAYER = process.env.RELAYER_URL ?? "https://jt-relayer-production.up.railway.app";
const INDEXER = process.env.INDEXER_URL ?? "https://jt-indexer-production.up.railway.app";
const RPC = process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const STATE = "tmp/e2e-state.json";

const key = process.env.TEST_WALLET_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("TEST_WALLET_PRIVATE_KEY is not set (source test-wallet.keys.env)");
const wallet = privateKeyToAccount(key);
const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const client = createPublicClient({ chain, transport: http(RPC) });

const rand = () => BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (label: string, v: unknown) => console.log(`\n== ${label}\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`);

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${url}: ${JSON.stringify(body)}`);
  return body as any;
}

function loadState(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}
function saveState(s: Record<string, string>) {
  mkdirSync("tmp", { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

async function relayAction(kind: string, action: Record<string, string>, signature: Hex) {
  const { id } = await json(`${RELAYER}/action`, { method: "POST", body: JSON.stringify({ kind, action, signature }) });
  for (let i = 0; i < 60; i++) {
    const s = await json(`${RELAYER}/action/${encodeURIComponent(id)}`);
    if (s.status === "executed" || s.status === "failed") return s;
    await sleep(1000);
  }
  throw new Error(`action ${id} still pending`);
}

async function deposit(amountUsd: string) {
  const cfg = await json(`${RELAYER}/config`);
  const usdg = cfg.collateral.address as Hex;
  const [nonce] = await Promise.all([
    client.readContract({ address: usdg, abi: parseAbi(["function nonces(address) view returns (uint256)"]), functionName: "nonces", args: [wallet.address] }),
  ]);
  const amount = parseUnits(amountUsd, 6);
  const deadline = BigInt(cfg.chainTime + 600);
  const signature = await wallet.signTypedData({
    domain: { name: "Global Dollar", version: "1", chainId: 4663, verifyingContract: usdg },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit",
    message: { owner: wallet.address, spender: cfg.contracts.Exchange, value: amount, nonce, deadline },
  });
  log("depositPermit", await relayAction("depositPermit", { user: wallet.address, amount: amount.toString(), nonce: nonce.toString(), deadline: deadline.toString() }, signature));
  log("account", await json(`${INDEXER}/api/account/${wallet.address}`));
}

async function connect() {
  const start = await json(`${CONNECTOR}/api/connect/start`, { method: "POST", body: JSON.stringify({ wallet: wallet.address }) });
  log("connect/start", { agentAddress: start.agentAddress, expiry: start.expiry });
  const cfg = await json(`${RELAYER}/config`);
  const skm = cfg.contracts.SessionKeyManager as Hex;
  const epoch = await client.readContract({ address: skm, abi: parseAbi(["function epochOf(address) view returns (uint64)"]), functionName: "epochOf", args: [wallet.address] });
  const action = { user: wallet.address, key: start.agentAddress, expiry: String(start.expiry), epoch: epoch.toString(), nonce: rand().toString(), deadline: String(cfg.chainTime + 600) };
  const { domain, types } = cfg.eip712Actions.sessionKeys;
  const signature = await wallet.signTypedData({
    domain,
    types: { RegisterSessionKey: types.RegisterSessionKey },
    primaryType: "RegisterSessionKey",
    message: { ...action, expiry: BigInt(action.expiry), epoch: BigInt(action.epoch), nonce: BigInt(action.nonce), deadline: BigInt(action.deadline) },
  });
  log("registerSessionKey", await relayAction("registerSessionKey", action, signature));
  const finish = await json(`${CONNECTOR}/api/connect/finish`, {
    method: "POST",
    body: JSON.stringify({ pendingId: start.pendingId, caps: { maxMarginUsd: 5, maxLeverage: 1000, dailyLossUsd: 5 } }),
  });
  saveState({ ...loadState(), mcpUrl: finish.mcpUrl });
  log("connect/finish", { agentAddress: finish.agentAddress, caps: finish.caps, mcpUrl: "saved to tmp/e2e-state.json" });
}

let rpcId = 0;
async function tool(name: string, args: Record<string, unknown> = {}) {
  const url = loadState().mcpUrl;
  if (!url) throw new Error("run `connect` first");
  const res = await json(url, { method: "POST", headers: { accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
  const text = res.result?.content?.[0]?.text ?? JSON.stringify(res);
  log(`${name}${res.result?.isError ? " (error)" : ""}`, text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function bet() {
  await tool("house_status");
  await tool("quote_bet", { market: "ETH", side: "long", margin_usd: 2, leverage: 50 });
  const placed = await tool("place_bet", { market: "ETH", side: "long", margin_usd: 2, leverage: 50 });
  await tool("my_bets");
  if (placed?.positionId) {
    await sleep(3000);
    await tool("cash_out", { position_id: String(placed.positionId) });
  }
  await tool("my_points");
}

async function liquidation() {
  const placed = await tool("place_bet", { market: "BTC", side: "long", margin_usd: 1, leverage: 1000 });
  if (!placed?.positionId) return;
  const id = String(placed.positionId);
  for (let i = 0; i < 120; i++) {
    const hist = await json(`${INDEXER}/api/history/${wallet.address}`);
    const end = hist.items.find((x: any) => x.id === id && (x.type === "liquidation" || x.type === "close"));
    if (end) return log(`position ${id} ended`, end);
    await sleep(5000);
  }
  log("liquidation", `position ${id} still open after 10 min`);
}

const [cmd, a1, a2] = process.argv.slice(2);
console.log(`wallet ${wallet.address}`);
if (cmd === "deposit") await deposit(a1 ?? "5");
else if (cmd === "connect") await connect();
else if (cmd === "bet") await bet();
else if (cmd === "liquidation") await liquidation();
else if (cmd === "tools") await tool(a1, a2 ? JSON.parse(a2) : {});
else console.log("usage: deposit <usd> | connect | bet | liquidation | tools <name> [json]");
