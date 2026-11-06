const env = import.meta.env;

const trimSlash = (s) => (s || "").trim().replace(/\/+$/, "");

// In production the connector serves this app, so it lives on the same origin.
export const CONNECTOR_URL =
  trimSlash(env.VITE_CONNECTOR_URL) || (env.DEV ? "http://localhost:8787" : window.location.origin);
export const RELAYER_URL = trimSlash(env.VITE_RELAYER_URL) || "https://hmrelayer-production.up.railway.app";
export const INDEXER_URL = trimSlash(env.VITE_INDEXER_URL) || "https://hmindexer-production.up.railway.app";
export const PRICES_URL = trimSlash(env.VITE_PRICES_URL) || "https://hmprices-production.up.railway.app";
export const RPC_URL = trimSlash(env.VITE_RPC_URL) || "https://rpc.mainnet.chain.robinhood.com";
// Empty by default: tx hashes then render as plain text.
export const EXPLORER_URL = trimSlash(env.VITE_EXPLORER_URL);

export const CHAIN_ID = 4663;
export const JACKTRADE_URL = "https://jacktrade.exchange";

// Robinhood Chain tokens used by "Make it real" (Definitive Flash chain key: "robinhood").
export const FLASH_CHAIN = "robinhood";
export const NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export const TOKENS = {
  USDG: { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
  TSLA: { symbol: "TSLA", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", decimals: 18 },
  NVDA: { symbol: "NVDA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", decimals: 18 },
  WETH: { symbol: "WETH", address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", decimals: 18 },
};
