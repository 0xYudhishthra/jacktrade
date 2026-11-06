export const PRICES_URL = (import.meta.env?.VITE_PRICES_URL ?? "https://jt-prices-production.up.railway.app").replace(/\/$/, "");
export const RELAYER_URL = (import.meta.env?.VITE_RELAYER_URL ?? "https://jt-relayer-production.up.railway.app").replace(/\/$/, "");
export const API_URL = (import.meta.env?.VITE_API_URL ?? "https://jt-indexer-production.up.railway.app").replace(/\/$/, "");
export const RPC_URL = (import.meta.env?.VITE_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com").replace(/\/$/, "");

export async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error ?? body.message ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body;
}

// Block explorer for tx / address links. Empty by default: hashes then render as plain text.
export const EXPLORER_URL = (import.meta.env?.VITE_EXPLORER_URL ?? "").replace(/\/+$/, "");
