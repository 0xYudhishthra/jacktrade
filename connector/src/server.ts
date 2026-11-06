import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type Request, type Response } from "express";
import { createPublicClient, getAddress, http, isAddress, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { assertConfig, config } from "./config.ts";
import { decrypt, encrypt, hashToken, newSecret } from "./crypto.ts";
import { Store, type Caps } from "./db.ts";
import { pointsLeaderboard, pointsOf } from "./points.ts";
import { buildServer } from "./tools.ts";
import { syncBets } from "./trading.ts";
import * as up from "./upstream.ts";

assertConfig();
const store = new Store(config.dbPath);
const chain = createPublicClient({ transport: http(config.rpcUrl) });
const sessionKeyAbi = parseAbi(["function isValidSessionKey(address user, address key) view returns (bool)"]);

const app = express();
app.disable("x-powered-by");
app.use(cors({ exposedHeaders: ["mcp-session-id"] }));
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------------- connect flow

app.post("/api/connect/start", async (req, res) => {
  const wallet = req.body?.wallet;
  if (typeof wallet !== "string" || !isAddress(wallet)) return void res.status(400).json({ message: "wallet must be an address" });
  const cfg = await up.relayerConfig();
  const key = generatePrivateKey();
  const agentAddress = privateKeyToAccount(key).address;
  const pendingId = newSecret();
  // Key lives as long as JackTrade allows (30 days), minus a minute of slack.
  const expiry = cfg.chainTime + cfg.limits.sessionKeyMaxDuration - 60;
  store.savePending({
    pendingId,
    wallet: getAddress(wallet),
    agentAddress,
    agentKeyEnc: encrypt(key, config.serverSecret),
    expiry,
    createdAt: Math.floor(Date.now() / 1000),
  });
  res.json({ pendingId, agentAddress, expiry });
});

function parseCaps(raw: any): Caps | null {
  const caps = {
    maxMarginUsd: Number(raw?.maxMarginUsd),
    maxLeverage: Number(raw?.maxLeverage),
    dailyLossUsd: Number(raw?.dailyLossUsd),
  };
  const valid =
    caps.maxMarginUsd >= 10 && caps.maxMarginUsd <= 10_000 &&
    Number.isInteger(caps.maxLeverage) && caps.maxLeverage >= 2 && caps.maxLeverage <= 1000 &&
    caps.dailyLossUsd >= caps.maxMarginUsd && caps.dailyLossUsd <= 100_000;
  return valid ? caps : null;
}

app.post("/api/connect/finish", async (req, res) => {
  const pending = typeof req.body?.pendingId === "string" ? store.takePending(req.body.pendingId) : null;
  if (!pending) return void res.status(404).json({ message: "Unknown or expired connect session; start again." });
  const caps = parseCaps(req.body?.caps);
  if (!caps) {
    return void res.status(400).json({
      message: "Caps: max bet $10–$10,000, leverage 2–1000, daily limit at least the max bet.",
    });
  }
  // Ownership proof: only the wallet itself can register this key on JackTrade's SessionKeyManager.
  const cfg = await up.relayerConfig();
  const valid = await chain.readContract({
    address: cfg.contracts.SessionKeyManager,
    abi: sessionKeyAbi,
    functionName: "isValidSessionKey",
    args: [pending.wallet as `0x${string}`, pending.agentAddress as `0x${string}`],
  });
  if (!valid) return void res.status(409).json({ message: "Grok's key isn't registered onchain yet. Approve it in your wallet first." });

  const token = newSecret(32);
  store.saveUser({
    tokenHash: hashToken(token),
    wallet: pending.wallet,
    agentAddress: pending.agentAddress,
    agentKeyEnc: pending.agentKeyEnc,
    caps,
    createdAt: Math.floor(Date.now() / 1000),
  });
  store.deletePending(pending.pendingId);
  res.json({ mcpUrl: `${config.publicUrl}/mcp/${token}`, agentAddress: pending.agentAddress, caps });
});

// ---------------------------------------------------------------- bets feed

app.get("/api/bets", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const bets = store.recentBets(limit);
  await syncBets(store, bets);
  res.json(store.recentBets(limit));
});

app.get("/api/points", async (_req, res) => {
  try {
    res.json(await pointsLeaderboard(25));
  } catch (e) {
    res.status(502).json({ message: String(e) });
  }
});

app.get("/api/points/:wallet", async (req, res) => {
  if (!isAddress(req.params.wallet)) return void res.status(400).json({ message: "wallet must be an address" });
  try {
    res.json(await pointsOf(req.params.wallet));
  } catch (e) {
    res.status(502).json({ message: String(e) });
  }
});

app.get("/api/bets/:id", async (req, res) => {
  const bet = store.bet(req.params.id);
  if (!bet) return void res.status(404).json({ message: "Bet not found" });
  await syncBets(store, [bet]);
  res.json(store.bet(bet.id));
});

// ---------------------------------------------------------------- Flash proxy (keeps the API key server-side)

async function flash(req: Request, res: Response, path: string, method: "GET" | "POST") {
  if (!config.flashApiKey) return void res.status(503).json({ message: "Flash is not configured" });
  const params = new URLSearchParams(req.query as Record<string, string>);
  // The web app sends `wallet`; Flash calls it `funderAddress`.
  if (params.has("wallet")) {
    params.set("funderAddress", params.get("wallet")!);
    params.delete("wallet");
  }
  const qs = params.toString();
  const upstream = await fetch(`${config.flashUrl}${path}${qs ? `?${qs}` : ""}`, {
    method,
    headers: { "x-definitive-api-key": config.flashApiKey, "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(req.body ?? {}) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  res.status(upstream.status).type("application/json").send(await upstream.text());
}

app.post("/api/flash/quote", (req, res) => flash(req, res, "/quote", "POST").catch((e) => res.status(502).json({ message: String(e) })));
app.post("/api/flash/order", (req, res) => flash(req, res, "/order", "POST").catch((e) => res.status(502).json({ message: String(e) })));
app.get("/api/flash/orders", (req, res) => flash(req, res, "/orders", "GET").catch((e) => res.status(502).json({ message: String(e) })));
app.get("/api/flash/orders/:id", (req, res) => {
  if (!/^[\w-]{1,128}$/.test(req.params.id)) return void res.status(400).json({ message: "bad order id" });
  flash(req, res, `/orders/${req.params.id}`, "GET").catch((e) => res.status(502).json({ message: String(e) }));
});

// ---------------------------------------------------------------- MCP (one stateless server per request)

async function handleMcp(req: Request, res: Response) {
  const token = String(req.params.token ?? "");
  const user = store.userByTokenHash(hashToken(token));
  if (!user) return void res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unknown connector URL" }, id: null });
  // The MCP transport rejects POSTs whose Accept header lacks either type; some hosted
  // connectors only send application/json.
  req.headers.accept = "application/json, text/event-stream";
  const server = buildServer(user, () => decrypt(user.agentKeyEnc, config.serverSecret) as `0x${string}`, store);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

app.post("/mcp/:token", (req, res) => {
  handleMcp(req, res).catch((e) => {
    console.error("mcp error", e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  });
});
// Stateless server: no SSE stream or session to resume.
app.get("/mcp/:token", (_req, res) => void res.status(405).set("allow", "POST").end());
app.delete("/mcp/:token", (_req, res) => void res.status(405).set("allow", "POST").end());

// ---------------------------------------------------------------- web app (single-page, same origin)

const webDist = resolve(config.webDist);
if (existsSync(join(webDist, "index.html"))) {
  app.use(express.static(webDist, { index: false, maxAge: "1h" }));
  app.get(/^\/(?!api\/|mcp\/|health$).*/, (_req, res) => res.sendFile(join(webDist, "index.html")));
}

app.listen(config.port, () => {
  console.log(`JackTrade connector on :${config.port}`);
});
