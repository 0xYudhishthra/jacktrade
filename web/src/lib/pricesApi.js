import { API_URL, PRICES_URL } from "./backend";

// Backend price service (see backend docs/precios-front.md): Pyth prices for BTC and ETH, and SPY and TSLA as equities
// (`marketOpen` tells whether they are trading; `preview: true` while the Exchange has not listed them). An equity whose
// Pyth feed is not enabled has no price at all (/history answers 503 FEED_UNAVAILABLE).
// One base URL gives both the HTTP endpoints and the websocket.
export { PRICES_URL };
export const PRICES_WS_URL = PRICES_URL.replace(/^http/, "ws");

// Front-end symbol ↔ market id in the contracts (instrumentId).
export const MARKET_IDS = { "BTC-PERP": 0, "ETH-PERP": 1, "SPY-PERP": 100, "TSLA-PERP": 101 };
// Markets priced around the clock (crypto). Equities are priced during market hours only.
export const ALWAYS_PRICED_IDS = new Set([0, 1]);
export const SYMBOLS = Object.fromEntries(Object.entries(MARKET_IDS).map(([s, id]) => [id, s]));
export const FEED_SYMBOLS = Object.keys(MARKET_IDS);

// How a preview market's price is described: live from Pyth, or no feed yet.
export const previewPriceLabel = (quote) => (quote ? "Pyth price" : "price feed coming soon");

// Intervals the backend serves, in seconds.
export const INTERVAL_SECONDS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14_400,
  "1d": 86_400,
};
const CANDLE_COUNT = 200;

async function getHistory(params, signal) {
  const response = await fetch(`${PRICES_URL}/history?${new URLSearchParams(params)}`, { signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? (response.status === 502 ? "Pyth did not respond" : `HTTP ${response.status}`));
  }
  return body;
}

// Opened notional per candle from the indexer (GET /api/volume), keyed by candle start in seconds.
async function fetchVolumeMap(market, interval, from, signal) {
  try {
    const response = await fetch(`${API_URL}/api/volume?${new URLSearchParams({ market, interval, from })}`, { signal });
    if (!response.ok) return new Map();
    const body = await response.json();
    return new Map(body.candles.map((c) => [c.t, Number(c.volume)]));
  } catch (error) {
    if (error.name === "AbortError") throw error;
    return new Map(); // the chart still works without volume bars
  }
}

// About 200 candles ending now, oldest first, in the chart's { t (ms), o, h, l, c, v } shape.
// v is the JackTrade volume (USDG notional opened in that candle); 0 for preview markets.
export async function fetchCandles(symbol, interval, signal) {
  const seconds = INTERVAL_SECONDS[interval];
  const from = Math.floor(Date.now() / 1000) - seconds * CANDLE_COUNT;
  const market = MARKET_IDS[symbol];
  const [body, volume] = await Promise.all([getHistory({ market, interval, from }, signal), fetchVolumeMap(market, interval, from, signal)]);
  return body.candles.map((c) => ({ t: c.t * 1000, o: c.o, h: c.h, l: c.l, c: c.c, v: volume.get(c.t) ?? 0 }));
}

// Recent raw ticks (up to the last 300 s) as { time (ms), price }.
export async function fetchTicks(symbol, seconds = 300, signal) {
  const from = Math.floor(Date.now() / 1000) - seconds;
  const body = await getHistory({ market: MARKET_IDS[symbol], interval: "tick", from }, signal);
  return body.ticks.map((t) => ({ time: t.t, price: t.usd }));
}

// Last 24 hours from hourly candles: open, high and low, combined with the live price by callers.
export async function fetchDayStats(symbol, signal) {
  const from = Math.floor(Date.now() / 1000) - 24 * 3600;
  const body = await getHistory({ market: MARKET_IDS[symbol], interval: "1h", from }, signal);
  if (body.candles.length === 0) throw new Error("No candles in the last 24h");
  return {
    open24h: body.candles[0].o,
    high24h: Math.max(...body.candles.map((c) => c.h)),
    low24h: Math.min(...body.candles.map((c) => c.l)),
  };
}
