/**
 * Config de Ponder. NETWORK=mainnet|fork, como el resto del backend.
 * - mainnet: logs por el RPC público (Alchemy gratis solo deja 10 bloques por eth_getLogs), desde el deploy.
 * - fork: desde el bloque del fork (antes de eso anvil le pediría los logs a Alchemy) y sin caché de RPC: cada fork
 *   tiene otra historia con los mismos números de bloque y el mismo chain id.
 * Base: Postgres si hay DATABASE_URL; si no, PGlite en .ponder/, una carpeta por red (y por fork).
 */
import { deployment } from "@hm/shared";
import { createConfig } from "ponder";
import { custom, http } from "viem";

const network = process.env.NETWORK ?? "mainnet";
if (network !== "mainnet" && network !== "fork") throw new Error(`NETWORK inválido: ${network}`);
const DEPLOY_BLOCK = 96_115_700; // deploy de los contratos (2026-10-27) en Robinhood Chain: el primer evento es del bloque 96.115.702

async function forkBlock(rpc: string) {
  const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_nodeInfo", params: [] }) });
  const info = (await res.json()) as { result?: { forkConfig?: { forkBlockNumber?: number } } };
  const block = info.result?.forkConfig?.forkBlockNumber;
  if (!block) throw new Error(`${rpc} no es un fork de anvil`);
  return block + 1;
}

const rpc = network === "fork" ? (process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545") : (process.env.LOGS_RPC_URL ?? deployment.rpcUrl);

// Mainnet: eth_getLogs over wide ranges (the historical backfill) goes to the logs RPC (public: Alchemy's free plan
// only allows 10 blocks); the chain head always from RPC_URL (Alchemy), so it never seems to go back between nodes;
// specific blocks, receipts and calls alternate between both, each one falling back to the other. On 2026-10-28 the
// indexer stalled ~12 min on 429s from the public RPC while catching up block by block.
function splitTransport(logsUrl: string, mainUrl: string | undefined) {
  const logs = http(logsUrl)({});
  const main = mainUrl && mainUrl !== logsUrl ? http(mainUrl)({}) : undefined;
  let turn = false;
  return custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      if (!main) return logs.request({ method, params } as never);
      if (method === "eth_getLogs") {
        const f = (params as [{ fromBlock?: string; toBlock?: string; blockHash?: string }])?.[0];
        const span = f?.blockHash ? 0 : f?.fromBlock?.startsWith("0x") && f?.toBlock?.startsWith("0x") ? Number(BigInt(f.toBlock) - BigInt(f.fromBlock)) : Infinity;
        if (span > 9) return logs.request({ method, params } as never);
      }
      // Realtime reads (a block per ~100 ms) alternate so neither RPC's rate limit decides how fast the indexer follows
      // the chain. "latest" (and other tags) stay on one node: two nodes a block apart would look like a reorg.
      const tag = (params as unknown[] | undefined)?.[0];
      const head = typeof tag === "string" && !tag.startsWith("0x");
      const [first, second] = head || !(turn = !turn) ? [main, logs] : [logs, main];
      try {
        const result = await first.request({ method, params } as never);
        // A block the other node already has may not have reached this one yet.
        if (result == null && method.startsWith("eth_getBlockBy")) return await second.request({ method, params } as never);
        return result;
      } catch {
        return second.request({ method, params } as never);
      }
    },
  });
}
const startBlock = process.env.INDEXER_FROM_BLOCK ? Number(process.env.INDEXER_FROM_BLOCK) : network === "fork" ? await forkBlock(rpc) : DEPLOY_BLOCK;
// En mainnet, empezar después del deploy deja posiciones y fila sin su origen y frena el indexado: solo a propósito.
if (network === "mainnet" && startBlock > DEPLOY_BLOCK && process.env.INDEXER_ALLOW_LATE_START !== "1") {
  throw new Error(`INDEXER_FROM_BLOCK (${startBlock}) es posterior al deploy (${DEPLOY_BLOCK}): faltarían datos. Si es a propósito, INDEXER_ALLOW_LATE_START=1`);
}

const c = deployment.contracts;
const contract = <A>(abi: A, address: `0x${string}`) => ({ abi, address, chain: "robinhood" as const, startBlock });

export default createConfig({
  // PONDER_DATABASE=pglite: the indexed chain data in an embedded database even with DATABASE_URL set (profiles stay in
  // Postgres). On Railway, committing every block to Postgres (~9 blocks/s on Robinhood Chain) left the indexer
  // ~3,400 blocks (~6 min) behind; embedded it keeps up within ~2 s. It is rebuilt from the chain on every deploy anyway.
  database: process.env.DATABASE_URL && process.env.PONDER_DATABASE !== "pglite"
    ? { kind: "postgres", connectionString: process.env.DATABASE_URL }
    : { kind: "pglite", directory: `.ponder/pglite-${network === "fork" ? `fork-${startBlock}` : "mainnet"}` },
  chains: {
    robinhood: {
      id: deployment.chainId,
      rpc: network === "fork" ? rpc : splitTransport(rpc, process.env.RPC_URL),
      // Robinhood Chain makes ~10 blocks/s. Stock Ponder fetched at most 50 missing blocks per poll and throttled itself
      // to 20 requests/s (down to 3 after errors), about the chain's own pace: any hiccup left it behind for good
      // (2026-10-28: 15+ min behind, no errors). patches/ponder@0.17.12.patch raises both (250 blocks, 60/15 rps).
      pollingInterval: network === "fork" ? 200 : Number(process.env.INDEXER_POLLING_MS ?? 500),
      disableCache: network === "fork",
      // El RPC público acepta hasta 100.000 bloques por eth_getLogs y Ponder pedía 100.001: el deploy no terminaba.
      ethGetLogsBlockRange: 50_000,
    },
  },
  contracts: {
    Exchange: contract(c.Exchange.abi, c.Exchange.address),
    SessionKeyManager: contract(c.SessionKeyManager.abi, c.SessionKeyManager.address),
    JackTradeStaking: contract(c.JackTradeStaking.abi, c.JackTradeStaking.address),
  },
});
