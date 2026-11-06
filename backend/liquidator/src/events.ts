import { deployment, safeError, type getNetwork } from "@hm/shared";
import type { Log } from "viem";

import type { PositionBook } from "./book.js";

type Client = ReturnType<typeof getNetwork>["client"];

const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
const EVENT_NAMES = [
  "PositionOpened",
  "PositionClosed",
  "PositionLiquidated",
  "MarketListed",
  "MarketConfigSet",
  "MarketRetired",
] as const;
const events = exchange.abi.filter((x) => x.type === "event" && (EVENT_NAMES as readonly string[]).includes(x.name));

type ExchangeLog = Log & { eventName: (typeof EVENT_NAMES)[number]; args: Record<string, unknown> };

export type SyncOptions = {
  client: Client; // para leer config del mercado
  logsClient: Client; // para eth_getLogs (en mainnet, el RPC público: Alchemy gratis solo deja 10 bloques)
  book: PositionBook;
  fromBlock: bigint;
  chunk: bigint; // bloques por consulta de logs
  confirmations: bigint; // bloques detrás de la punta: un RPC atrasado o balanceado no hace perder eventos
  pollMs: number;
  onEvent?: (description: string) => void;
  onRetired?: (instrumentId: number, frozenPrice: bigint) => void;
};

/**
 * Lee la historia desde `fromBlock` y después sigue los bloques nuevos. Mantiene `book` al día.
 * Un log que no se puede aplicar (por ejemplo, falla la lectura de la config) no traba el cursor: queda apartado y se
 * reintenta en cada vuelta. Así un problema puntual no deja ciego al liquidador para todos los mercados.
 */
export function syncPositions(o: SyncOptions) {
  let stopped = false;
  let next = o.fromBlock;
  let timer: NodeJS.Timeout | undefined;
  const parked: ExchangeLog[] = [];

  async function loadMarket(instrumentId: number) {
    const cfg = await o.client.readContract({ ...exchange, functionName: "marketConfig", args: [instrumentId] });
    o.book.setBuffer(instrumentId, cfg.liqBufferBps);
    return cfg.liqBufferBps;
  }

  async function apply(log: ExchangeLog) {
    const a = log.args as Record<string, never>;
    switch (log.eventName) {
      case "PositionOpened": {
        const instrumentId = Number(a.instrumentId);
        if (!o.book.hasBuffer(instrumentId)) await loadMarket(instrumentId);
        o.book.open(
          { id: a.positionId, user: a.user, instrumentId, isLong: a.isLong, margin: a.margin, leverage: a.leverage, entryPrice: a.entryPrice },
          log.blockNumber!,
        );
        o.onEvent?.(`abierta ${a.positionId} (bloque ${log.blockNumber})`);
        break;
      }
      case "PositionClosed":
      case "PositionLiquidated": {
        // Si el open de esta posición estaba apartado (no se pudo aplicar), ya no hace falta.
        const i = parked.findIndex((p) => p.eventName === "PositionOpened" && p.args.positionId === a.positionId);
        if (i >= 0) parked.splice(i, 1);
        if (o.book.remove(a.positionId)) o.onEvent?.(`${log.eventName === "PositionClosed" ? "cerrada" : "liquidada"} ${a.positionId}`);
        break;
      }
      case "MarketListed":
      case "MarketConfigSet": {
        const buffer = await loadMarket(Number(a.instrumentId));
        o.onEvent?.(`${log.eventName === "MarketListed" ? "mercado nuevo" : "config del mercado"} ${a.instrumentId}: liqBufferBps ${buffer}`);
        break;
      }
      case "MarketRetired":
        o.onEvent?.(`mercado ${a.instrumentId} retirado a precio congelado`);
        o.onRetired?.(Number(a.instrumentId), a.frozenPrice);
        break;
    }
  }

  async function applySafely(log: ExchangeLog) {
    try {
      await apply(log);
    } catch (e) {
      parked.push(log);
      console.error(`⚠ ALERTA [eventos] no se pudo aplicar ${log.eventName} (bloque ${log.blockNumber}): ${safeError(e)} · se reintenta`);
    }
  }

  async function retryParked() {
    for (const log of parked.splice(0)) await applySafely(log);
  }

  // Tramo de bloques por consulta: se achica a la mitad si el RPC falla (rango o resultados de más) y vuelve a
  // crecer de a poco. Con un tramo fijo, un rango que siempre falla trababa la lectura para siempre.
  let chunk = o.chunk;
  let lastGood = Date.now();

  async function readUpTo(to: bigint) {
    while (next <= to && !stopped) {
      const end = next + chunk - 1n < to ? next + chunk - 1n : to;
      let logs;
      try {
        logs = await o.logsClient.getLogs({ address: exchange.address, events, fromBlock: next, toBlock: end, strict: true });
      } catch (e) {
        if (chunk > 1n) chunk = chunk / 2n > 0n ? chunk / 2n : 1n;
        throw e;
      }
      if (chunk < o.chunk) chunk = chunk * 2n < o.chunk ? chunk * 2n : o.chunk;
      // getLogs devuelve en orden de bloque y de índice dentro del bloque: se aplican así.
      for (const log of logs) await applySafely(log as unknown as ExchangeLog);
      next = end + 1n;
    }
    lastGood = Date.now();
  }

  const target = async () => (await o.logsClient.getBlockNumber()) - o.confirmations;

  // Historia: con reintentos (miles de consultas a un RPC público pueden fallar alguna vez).
  const caughtUp = (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        await readUpTo(await target());
        return;
      } catch (e) {
        if (attempt >= 8) throw e;
        console.error(`[eventos] error leyendo la historia (intento ${attempt}): ${safeError(e)} · reintento`);
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 30_000)));
      }
    }
  })();

  const poll = async () => {
    try {
      await retryParked();
      await readUpTo(await target());
    } catch (e) {
      console.error(`[eventos] ${safeError(e)}`);
    }
    if (!stopped) timer = setTimeout(poll, o.pollMs);
  };
  void caughtUp.then(() => !stopped && (timer = setTimeout(poll, o.pollMs)));

  return {
    caughtUp,
    lastBlock: () => next - 1n,
    lastGood: () => lastGood,
    parked: () => parked.length,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/**
 * Desde qué bloque leer. En el fork, desde donde arrancó (antes no hay nada de JackTrade en la copia local).
 * En mainnet, LIQUIDATOR_FROM_BLOCK o, si no está, el bloque donde se desplegó el Exchange (búsqueda binaria con getCode,
 * necesita un RPC de archivo).
 */
/** Exchange deploy block, from the generated deployment config (shared/src/generated). */
export const EXCHANGE_DEPLOY_BLOCK = BigInt(deployment.deployBlock);

export async function startBlock(client: Client, network: string): Promise<bigint> {
  const head = await client.getBlockNumber();
  if (process.env.LIQUIDATOR_FROM_BLOCK) {
    const from = BigInt(process.env.LIQUIDATOR_FROM_BLOCK);
    if (from > head) throw new Error(`LIQUIDATOR_FROM_BLOCK (${from}) es mayor que el último bloque (${head})`);
    // Solo un control: si el RPC no tiene estado viejo (o no lo da), se avisa y se sigue con el bloque indicado.
    try {
      const code = await client.getCode({ address: exchange.address, blockNumber: from });
      if (code && code !== "0x" && from > 0n) {
        const before = await client.getCode({ address: exchange.address, blockNumber: from - 1n });
        if (before && before !== "0x") console.warn(`⚠ LIQUIDATOR_FROM_BLOCK (${from}) es posterior al deploy del Exchange: se pierden las posiciones abiertas antes`);
      }
    } catch (e) {
      console.warn(`⚠ no se pudo verificar LIQUIDATOR_FROM_BLOCK con eth_getCode (¿RPC sin archivo?): ${safeError(e)} · se usa igual`);
    }
    return from;
  }
  if (network === "fork") {
    const info = await client.request({ method: "anvil_nodeInfo" as never });
    return BigInt((info as { forkConfig: { forkBlockNumber: number } }).forkConfig.forkBlockNumber);
  }
  // Sin LIQUIDATOR_FROM_BLOCK: el deploy del Exchange (fijo, así no hace falta un RPC de archivo para buscarlo).
  if (process.env.LIQUIDATOR_SEARCH_DEPLOY !== "1") return EXCHANGE_DEPLOY_BLOCK;
  let lo = 0n;
  let hi = head;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const code = await client.getCode({ address: exchange.address, blockNumber: mid });
    if (code && code !== "0x") hi = mid;
    else lo = mid + 1n;
  }
  // Un nodo sin archivo devuelve "sin código" para todo bloque viejo y la búsqueda termina en la punta: libro vacío.
  if (lo >= head) throw new Error("no se encontró el bloque del deploy del Exchange (¿el RPC no es de archivo?): usar LIQUIDATOR_FROM_BLOCK");
  return lo;
}
