import { deployment } from "@hm/shared";
import type { Hex } from "viem";

import { fetchLatest, streamHermes, type HermesSource } from "./hermes.js";
import { PriceStore, type PriceUpdate } from "./store.js";

export { PriceStore, type PriceUpdate } from "./store.js";

export const markets = deployment.markets.map((m) => ({ id: m.id, name: m.name, feedId: m.pythId as Hex }));

const EQUITIES = [
  { id: 100, name: "SPY/USD", pyth: { feedId: "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5", symbol: "Equity.US.SPY/USD" } },
  { id: 101, name: "TSLA/USD", pyth: { feedId: "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1", symbol: "Equity.US.TSLA/USD" } },
] as const satisfies readonly { id: number; name: string; pyth: { feedId: Hex; symbol: string } }[];

/**
 * Acciones (SPY, TSLA): precio de Pyth, que solo publica en horario de mercado (extendido). Ids desde 100 para no chocar
 * con los cripto. Se operan cuando el Exchange las lista (`listed`); si no, el front las muestra como preview. Si la
 * clave no tiene acceso al feed, no hay precio (ver preview.ts).
 */
export const previewMarkets = EQUITIES.map((m) => ({ ...m, listed: markets.some((x) => (x.id as number) === m.id) }));
const equityFeeds = new Set<string>(EQUITIES.map((m) => m.pyth.feedId.toLowerCase()));
/** true para los feeds de acciones: fuera de horario no cambian, y un precio viejo ahí no es una falla. */
export const isEquityFeed = (feedId: Hex) => equityFeeds.has(feedId.toLowerCase());
export type PreviewMarket = (typeof previewMarkets)[number];

/** Feed de precios en memoria. Cada proceso (relayer, liquidador, websocket) arma el suyo. */
export function createPriceFeed({
  url = process.env.HERMES_URL ?? "https://pyth.dourolabs.app/hermes",
  apiKey = process.env.HERMES_API_KEY,
  onStatus,
  onUpdate,
  historySeconds,
  withEquities = true,
}: {
  url?: string;
  apiKey?: string;
  /** Segundos de precios que se guardan por feed (default 60). */
  historySeconds?: number;
  onStatus?: (status: string) => void;
  /** Se llama con cada precio nuevo que entra al almacén (los desordenados se descartan antes). */
  onUpdate?: (update: PriceUpdate) => void;
  /** false: solo los mercados cripto (el servidor de precios sigue las acciones por su cuenta). */
  withEquities?: boolean;
} = {}) {
  if (!apiKey) throw new Error("Falta HERMES_API_KEY");
  // Respaldo opcional: otra fuente de Hermes (otra clave u otro proveedor). Sin esto, solo la principal.
  const sources: HermesSource[] = [{ url, apiKey, name: "primary" }];
  if (process.env.HERMES_FALLBACK_URL) sources.push({ url: process.env.HERMES_FALLBACK_URL, apiKey: process.env.HERMES_FALLBACK_API_KEY, name: "fallback" });
  const store = new PriceStore(historySeconds);
  const controller = new AbortController();
  const add = (u: PriceUpdate) => {
    if (!store.add(u)) return;
    // Un error en quien consume (relayer, liquidador, websocket) no puede cortar el stream para todos.
    try {
      onUpdate?.(u);
    } catch (e) {
      onStatus?.(`error processing a price: ${(e as Error).message?.split("\n")[0]}`);
    }
  };
  const crypto = markets.filter((m) => !isEquityFeed(m.feedId)).map((m) => m.feedId);
  const equities = withEquities ? markets.filter((m) => isEquityFeed(m.feedId)).map((m) => m.feedId) : [];
  const streams = [streamHermes({ sources, feedIds: crypto, onUpdate: add, onStatus, signal: controller.signal })];
  if (equities.length) {
    // Stream aparte: Hermes responde 403 a todo el stream si la clave pierde un solo feed de acciones, y eso no puede
    // dejar sin precio a BTC/ETH. Fuera de horario no llega nada: el último precio se pide por REST cada minuto.
    streams.push(streamHermes({ sources, feedIds: equities, onUpdate: add, onStatus: (s) => onStatus?.(`equities: ${s}`), signal: controller.signal, idleMs: 60_000 }));
    const seed = () => fetchLatest({ source: sources[0]!, feedIds: equities, onUpdate: add }).catch((e: Error) => onStatus?.(`equities: last price: ${e.message}`));
    void seed();
    const timer = setInterval(seed, 60_000);
    timer.unref();
    controller.signal.addEventListener("abort", () => clearInterval(timer));
  }
  const done = Promise.all(streams).then(() => {});
  return { store, stop: () => (controller.abort(), done) };
}

/** Precio en dólares como número, solo para mostrar. Los cálculos usan bigint. */
export function toUsd(value: bigint, expo: number) {
  return Number(value) * 10 ** expo;
}
