import { createPublicClient, defineChain, fallback, http, type Transport } from "viem";

import mainnet from "./generated/jacktrade.4663.js";

export type NetworkName = "mainnet" | "fork";

// El fork de anvil conserva el chain id 4663 y las direcciones de mainnet.
export const deployment = mainnet;

export function getNetwork(name = (process.env.NETWORK ?? "mainnet") as NetworkName) {
  if (name !== "mainnet" && name !== "fork") throw new Error(`NETWORK inválida: ${name}`);
  const rpcUrl =
    name === "fork"
      ? (process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545")
      : (process.env.RPC_URL ?? deployment.rpcUrl);

  const chain = defineChain({
    id: deployment.chainId,
    name: deployment.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Blockscout", url: deployment.explorer } },
  });

  // Robinhood Chain hace un bloque cada ~100 ms; el default de viem (4 s) haría esperar recibos y eventos de más.
  const pollingInterval = Number(process.env.POLLING_INTERVAL_MS ?? 200);
  // En el fork, anvil puede tardar varios segundos mientras baja estado o procesa tandas grandes: más margen que el default (10 s).
  const timeout = Number(process.env.RPC_TIMEOUT_MS ?? (name === "fork" ? 30_000 : 10_000));
  const transport = rpcTransport(rpcUrl, name === "fork" ? [] : rpcFallbacks(rpcUrl), timeout);
  return { name, rpcUrl, chain, timeout, transport, client: createPublicClient({ chain, transport, pollingInterval }) };
}

/**
 * RPCs de respaldo (mainnet): `RPC_FALLBACK_URLS` separados por coma o, si no está, el RPC público de Robinhood Chain.
 * Si el principal (Alchemy) falla o no responde, viem pasa solo al siguiente. El público no guarda estado viejo
 * (~10 min), pero alcanza para operar: lo que se pierde en el respaldo es solo la conciliación histórica.
 */
export function rpcFallbacks(primary: string) {
  const list = (process.env.RPC_FALLBACK_URLS ?? deployment.rpcUrl).split(",").map((u) => u.trim()).filter(Boolean);
  return list.filter((u) => u !== primary);
}

export function rpcTransport(primary: string, fallbacks: string[], timeout: number): Transport {
  const main = http(primary, { timeout });
  if (fallbacks.length === 0) return main;
  return fallback([main, ...fallbacks.map((u) => http(u, { timeout }))], { rank: false, retryCount: 1 });
}
