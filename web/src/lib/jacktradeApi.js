import { getAddress } from "viem";

import { API_URL, requestJson } from "./backend.js";

// Read-only JackTrade API (indexer). Every amount is a decimal string (USDG with 6 decimals applied, the HOUSE token with
// 18), prices are decimal strings, times are Unix seconds, addresses are lowercase.
// Full reference: https://hmindexer-production.up.railway.app/docs

const get = (path, params) => {
  const query = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")) : null;
  return requestJson(`${API_URL}${path}${query && [...query].length ? `?${query}` : ""}`);
};

// Fees (bps), deposit/withdraw minimums and per-market limits (leverage, margin, notional, OI caps, liquidation buffer).
export const fetchApiConfig = () => get("/api/config");

// Markets with live price, OI, caps, limits and 24h volume.
export const fetchMarkets = () => get("/api/markets");

// Protocol totals now (trades, volume, fees, house PnL, queue, bankroll).
export const fetchStats = () => get("/api/stats");

// HOUSE minted per 1 USDG lost, and the tracked LP size that sets it.
export const fetchRate = () => get("/api/rate");

// Global feed, newest first. kind: comma list of open, close, liquidation, deposit, withdraw, queued, queuePaid, stake,
// unstake, claim, mint, distribution, or the shortcuts trades, transfers, staking, queue. Pass `next` back as cursor.
export const fetchActivity = ({ kind, user, market, limit, cursor } = {}) => get("/api/activity", { kind, user, market, limit, cursor });

// One wallet's realized PnL, net deposits and equity (net deposits + realized PnL) after every close and transfer.
export const fetchPnlSeries = (user, window = "all") => get(`/api/pnl/${user}`, { window });

// Opened notional per candle for the volume bars (same grid as the price candles). interval: 1m, 5m, 15m, 1h, 4h, 1d.
export const fetchVolume = (market, interval, from, to) => get("/api/volume", { market, interval, from, to });

// The house's exposure now: OI per side, leverage mix, liquidation map (±50 % of price), what ±1/2/5/10 % moves cost.
export const fetchHouse = () => get("/api/house");

// Protocol totals over time (house PnL, fees, queue, deposits, OI, per-market OI). window: 24h, 7d, 30d, all.
export const fetchStatsHistory = (window = "7d", interval) => get("/api/stats/history", { window, interval });

// HOUSE supply, staking totals and rewards distributed.
export const fetchToken = () => get("/api/token");

// Rewards distributed, tokens minted and total staked per bucket.
export const fetchTokenHistory = (window = "30d", interval) => get("/api/token/history", { window, interval });

// Leaderboard v2. Omit params that have their default value (window=all, page=0, sortKey=rank).
export const fetchLeaderboardAccounts = ({ window, page, q, sortKey, sortDir } = {}) =>
  get("/api/leaderboard/accounts", { window: window === "all" ? undefined : window, page: page || undefined, q: q?.trim(), sortKey: sortKey === "rank" ? undefined : sortKey, sortDir });
export const fetchLeaderboardPositions = (window = "all") => get("/api/leaderboard/positions", { window: window === "all" ? undefined : window });

// Profiles (usernames signed by the wallet).
export const fetchProfile = (wallet) => get(`/api/profile/${wallet}`);
export const fetchProfileByUsername = (username) => get(`/api/profile/by-username/${encodeURIComponent(username)}`);

// What the wallet signs to set a username. Built here, never taken from the server: a compromised API must not be able
// to make the wallet sign something else (a token permit, for example). Must match backend indexer/src/profiles/rules.ts.
const PROFILE_CHAIN_ID = 4663;
const PROFILE_TYPES = {
  SetUsername: [
    { name: "wallet", type: "address" },
    { name: "username", type: "string" },
    { name: "nonce", type: "bytes32" },
    { name: "expires", type: "uint256" },
  ],
};

/** Typed data and plain message for a challenge; only nonce and expiry come from the server, and both are checked. */
export function profileSignature(wallet, username, challenge) {
  const nonce = challenge?.typedData?.message?.nonce;
  const expires = String(challenge?.typedData?.message?.expires ?? "");
  if (!/^0x[0-9a-f]{64}$/i.test(nonce ?? "") || !/^\d{1,12}$/.test(expires)) throw new Error("The profile server sent an invalid challenge.");
  const seconds = Number(expires);
  const now = Date.now() / 1000;
  if (seconds < now || seconds > now + 3600) throw new Error("The profile server sent an invalid challenge.");
  const checksummed = getAddress(wallet);
  return {
    typedData: {
      domain: { name: "JackTrade Profile", version: "1", chainId: PROFILE_CHAIN_ID },
      types: PROFILE_TYPES,
      primaryType: "SetUsername",
      message: { wallet: checksummed, username, nonce, expires: BigInt(expires) },
    },
    message: [
      "JACKTRADE profile",
      `Wallet: ${checksummed}`,
      `Username: ${username}`,
      `Nonce: ${nonce}`,
      `Expires: ${new Date(seconds * 1000).toISOString()}`,
      `Chain ID: ${PROFILE_CHAIN_ID}`,
    ].join("\n"),
  };
}

// Wallets that cannot sign typed data say so with these codes or words; anything else (a rejection, an error) is not
// retried as a plain message.
const unsupported = (error) => [4200, -32601].includes(error?.code) || /not supported|unsupported|does not support|method not found/i.test(error?.message ?? "");

/**
 * Claim or change the username: the wallet signs a one-time challenge (typed data, or a plain message as fallback).
 * Errors carry `code`: INVALID_USERNAME, USERNAME_TAKEN, INVALID_SIGNATURE, CHALLENGE_EXPIRED, CHANGE_TOO_SOON.
 */
export async function claimUsername(walletClient, wallet, rawUsername) {
  const username = String(rawUsername).trim().toLowerCase(); // the server stores and signs the lowercase name
  const post = (path, method, body) => requestJson(`${API_URL}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const challenge = await post("/api/profile/challenge", "POST", { wallet, username });
  const { typedData, message } = profileSignature(wallet, username, challenge);
  let signature;
  try {
    signature = await walletClient.signTypedData({ account: wallet, ...typedData });
  } catch (error) {
    if (!unsupported(error)) throw error;
    signature = await walletClient.signMessage({ account: wallet, message });
  }
  return post("/api/profile/username", "PUT", { wallet, username, challengeId: challenge.challengeId, signature });
}
