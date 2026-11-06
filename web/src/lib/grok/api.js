// Hackathon addition (ETHGlobal Mumbai 2026): the JackTrade Grok connector's REST API, the relayer's /action route
// and the Definitive Flash proxy (the connector adds the Flash API key server-side).
import { CONNECTOR_URL, INDEXER_URL, PRICES_URL, RELAYER_URL } from "./config.js";

export class ApiError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function request(url, { method = "GET", body, timeout = 20_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new ApiError(
      err?.name === "AbortError" ? `Request timed out: ${url}` : `Can't reach ${new URL(url).origin}`,
      { status: 0 },
    );
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    // Shapes seen: {code,message,error} (relayer), {error:{code,message}} (Flash), {error:"..."}.
    const e = data && typeof data === "object" ? data : {};
    const nested = e.error && typeof e.error === "object" ? e.error : null;
    const code = nested?.code || e.code;
    const message =
      nested?.message || e.message || (typeof e.error === "string" ? e.error : null) || `HTTP ${res.status}`;
    throw new ApiError(code ? `${code}: ${message}` : message, { status: res.status, code, body: data });
  }
  return data;
}

// ---- Relayer ----
let configCache = null;
export async function getRelayerConfig(force = false) {
  if (!configCache || force) configCache = await request(`${RELAYER_URL}/config`);
  return configCache;
}
export const postAction = (payload) => request(`${RELAYER_URL}/action`, { method: "POST", body: payload });
export const getAction = (id) => request(`${RELAYER_URL}/action/${encodeURIComponent(id)}`);

// ---- Indexer ----
export const getAccount = (user) => request(`${INDEXER_URL}/api/account/${user.toLowerCase()}`);

// ---- Prices ----
export async function getPrices() {
  const data = await request(`${PRICES_URL}/prices`, { timeout: 10_000 });
  return Array.isArray(data) ? data : [];
}

// ---- Connector ----
export const connectStart = (wallet) =>
  request(`${CONNECTOR_URL}/api/connect/start`, { method: "POST", body: { wallet } });
export const connectFinish = (pendingId, caps) =>
  request(`${CONNECTOR_URL}/api/connect/finish`, { method: "POST", body: { pendingId, caps } });

export const getPoints = (wallet) => request(`${CONNECTOR_URL}/api/points/${wallet}`);
export async function getPointsLeaderboard() {
  const data = await request(`${CONNECTOR_URL}/api/points`);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.leaderboard)) return data.leaderboard;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}

export async function getBets(limit = 50) {
  const data = await request(`${CONNECTOR_URL}/api/bets?limit=${limit}`);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.bets)) return data.bets;
  return [];
}

export async function getBet(id) {
  try {
    const data = await request(`${CONNECTOR_URL}/api/bets/${encodeURIComponent(id)}`);
    return data?.bet ?? data;
  } catch (err) {
    if (err.status !== 404 && err.status !== 405) throw err;
    // Fallback: find it in the public feed.
    const list = await getBets(200);
    const hit = list.find((b) => String(b.id) === String(id));
    if (!hit) throw new ApiError("Bet not found", { status: 404 });
    return hit;
  }
}

// ---- Definitive Flash, proxied by the connector ----
export const flashQuote = (body) =>
  request(`${CONNECTOR_URL}/api/flash/quote`, { method: "POST", body, timeout: 45_000 });
export const flashOrder = (body) =>
  request(`${CONNECTOR_URL}/api/flash/order`, { method: "POST", body, timeout: 45_000 });
export async function flashOrders(wallet) {
  const data = await request(`${CONNECTOR_URL}/api/flash/orders?wallet=${wallet}`);
  return Array.isArray(data) ? data : data?.orders || [];
}
// Optional connector route (single order + fills with tx hashes). Fails soft.
export async function flashOrderDetail(orderId, wallet) {
  try {
    return await request(`${CONNECTOR_URL}/api/flash/orders/${encodeURIComponent(orderId)}?wallet=${wallet}`);
  } catch {
    return null;
  }
}
