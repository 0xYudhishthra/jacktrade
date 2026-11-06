import { createPublicClient, defineChain, http } from "viem";
import { CHAIN_ID, EXPLORER_URL, RPC_URL } from "./config.js";

export const robinhood = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  ...(EXPLORER_URL
    ? { blockExplorers: { default: { name: "Explorer", url: EXPLORER_URL } } }
    : {}),
});

export const publicClient = createPublicClient({ chain: robinhood, transport: http(RPC_URL) });

export const sessionKeyManagerAbi = [
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

export function txUrl(hash) {
  return EXPLORER_URL && hash ? `${EXPLORER_URL}/tx/${hash}` : null;
}

export function addressUrl(addr) {
  return EXPLORER_URL && addr ? `${EXPLORER_URL}/address/${addr}` : null;
}

export function short(addr, n = 4) {
  if (!addr) return "";
  return `${addr.slice(0, 2 + n)}…${addr.slice(-n)}`;
}
