// Hackathon addition (ETHGlobal Mumbai 2026): settings for the Grok connector and Definitive Flash features.
// The exchange's own service URLs (relayer, indexer, prices, RPC) come from the pre-existing backend.js.
export { API_URL as INDEXER_URL, PRICES_URL, RELAYER_URL, RPC_URL, EXPLORER_URL } from "@/lib/backend";

const env = import.meta.env ?? {};
const trimSlash = (s) => (s || "").trim().replace(/\/+$/, "");

// The connector serves this app in production, so it lives on the same origin.
export const CONNECTOR_URL =
  trimSlash(env.VITE_CONNECTOR_URL) || (env.DEV ? "http://localhost:8787" : window.location.origin);

export const CHAIN_ID = 4663;

// Robinhood Chain tokens used by "Make it real" (Definitive Flash chain key: "robinhood").
export const FLASH_CHAIN = "robinhood";
export const NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export const TOKENS = {
  USDG: { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
  TSLA: { symbol: "TSLA", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", decimals: 18 },
  NVDA: { symbol: "NVDA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", decimals: 18 },
  WETH: { symbol: "WETH", address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", decimals: 18 },
};

export const SESSION_KEY_MANAGER_ABI = [
  {
    type: "function",
    name: "epochOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "isValidSessionKey",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "key", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "revokeSessionKey",
    stateMutability: "nonpayable",
    inputs: [{ name: "key", type: "address" }],
    outputs: [],
  },
];
