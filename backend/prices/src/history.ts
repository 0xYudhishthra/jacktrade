/**
 * Historial de precios para el gráfico del front.
 * - Velas: las da Pyth (endpoint de historia, formato TradingView). No se guardan acá: se piden y se cachean unos segundos.
 * - Ticks: los últimos segundos que el servicio ya tiene en memoria, del mismo stream de Hermes que el websocket.
 */

export const INTERVALS = {
  "1m": { seconds: 60, resolution: "1" },
  "5m": { seconds: 300, resolution: "5" },
  "15m": { seconds: 900, resolution: "15" },
  "1h": { seconds: 3600, resolution: "60" },
  "4h": { seconds: 14_400, resolution: "240" },
  "1d": { seconds: 86_400, resolution: "1D" },
} as const;
export type Interval = keyof typeof INTERVALS;

export const MAX_CANDLES = 500;
export const MAX_TICK_SECONDS = 300;

export type Candle = { t: number; o: number; h: number; l: number; c: number };

export type HistoryQuery =
  | { kind: "candles"; market: number; interval: Interval; from: number; to: number }
  | { kind: "ticks"; market: number; from: number };

/** Valida los parámetros de `GET /history`. Tira Error con un mensaje para el 400. */
export function parseHistoryQuery(params: URLSearchParams, marketIds: readonly number[], now = Math.floor(Date.now() / 1000)): HistoryQuery {
  const market = Number(params.get("market"));
  if (!params.has("market") || !marketIds.includes(market)) throw new Error(`market must be one of: ${marketIds.join(", ")}`);

  const interval = params.get("interval") ?? "";
  const from = Number(params.get("from"));
  if (!params.has("from") || !Number.isInteger(from) || from < 0) throw new Error("from must be an integer (Unix seconds)");

  if (interval === "tick") return { kind: "ticks", market, from: Math.max(from, now - MAX_TICK_SECONDS) };

  if (!(interval in INTERVALS)) throw new Error(`interval must be one of: ${[...Object.keys(INTERVALS), "tick"].join(", ")}`);
  const rawTo = params.has("to") ? Number(params.get("to")) : now;
  if (!Number.isInteger(rawTo) || rawTo <= from) throw new Error("to must be an integer greater than from");

  // Rango alineado a la grilla del intervalo: los pedidos caen en pocas claves de caché (y no se puede forzar un pedido
  // nuevo a Pyth variando un segundo). `to` nunca más allá de la vela abierta; como mucho MAX_CANDLES, las más nuevas.
  const step = INTERVALS[interval as Interval].seconds;
  const to = Math.ceil(Math.min(rawTo, now + step) / step) * step;
  const start = Math.floor(Math.max(from, to - MAX_CANDLES * step) / step) * step;
  return { kind: "candles", market, interval: interval as Interval, from: start, to };
}

type PythHistory = { s: string; t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; errmsg?: string };

/** Pasa la respuesta de Pyth (columnas) a velas, ordenadas de la más vieja a la más nueva, solo dentro de [from, to]. */
export function toCandles(r: PythHistory, from: number, to: number, step: number): Candle[] {
  if (r.s === "no_data") return [];
  if (r.s !== "ok") throw new Error(`Pyth: ${r.errmsg ?? r.s}`);
  if (!r.t) return [];
  return r.t
    .map((t, i) => ({ t, o: r.o![i]!, h: r.h![i]!, l: r.l![i]!, c: r.c![i]! }))
    .filter((c) => c.t + step > from && c.t <= to)
    .sort((a, b) => a.t - b.t)
    .slice(-MAX_CANDLES);
}

/** Lo que no se le pide a Pyth porque se pasó el tope global: el server responde 503, no 502. */
export class UpstreamBusy extends Error {}

/**
 * Pide velas a Pyth con un caché corto (muchos navegadores piden lo mismo) y un tope **global** de pedidos por segundo:
 * el límite por IP no alcanza contra muchas IPs, y si Pyth frena la clave se queda sin precios todo lo que la comparte.
 */
export function createCandleSource({
  url = process.env.PYTH_HISTORY_URL ?? "https://pyth.dourolabs.app/v1/fixed_rate@1000ms/history",
  // Conviene una clave aparte: si alguien abusa de /history y Pyth la frena, el stream de precios (relayer y liquidador) sigue.
  apiKey = process.env.PYTH_HISTORY_API_KEY ?? process.env.HERMES_API_KEY,
  cacheMs = Number(process.env.HISTORY_CACHE_MS ?? 5000),
  maxPerSecond = Number(process.env.HISTORY_UPSTREAM_PER_SECOND ?? 5),
  burst = Number(process.env.HISTORY_UPSTREAM_BURST ?? 20),
  now = Date.now,
}: { url?: string; apiKey?: string; cacheMs?: number; maxPerSecond?: number; burst?: number; now?: () => number } = {}) {
  const cache = new Map<string, { at: number; candles: Promise<Candle[]> }>();
  let tokens = burst;
  let refilledAt = now();
  const takeToken = () => {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - refilledAt) / 1000) * maxPerSecond);
    refilledAt = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };

  return async function candles(symbol: string, interval: Interval, from: number, to: number): Promise<Candle[]> {
    const { seconds, resolution } = INTERVALS[interval];
    // Redondear al intervalo para que pedidos casi iguales compartan caché.
    const key = `${symbol}|${interval}|${Math.floor(from / seconds)}|${Math.floor(to / seconds)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < cacheMs) return hit.candles;
    if (!takeToken()) throw new UpstreamBusy("Pyth request cap reached");

    const query = new URLSearchParams({ symbol, resolution, from: String(from), to: String(to) });
    const candles = fetch(`${url}?${query}`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }).then(async (res) => {
      if (!res.ok) throw new Error(`Pyth respondió ${res.status}`);
      return toCandles((await res.json()) as PythHistory, from, to, seconds);
    });
    cache.set(key, { at: Date.now(), candles });
    candles.catch(() => cache.delete(key));
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return candles;
  };
}
