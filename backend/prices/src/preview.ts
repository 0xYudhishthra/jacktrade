/**
 * Mercados preview (SPY, TSLA): precio solo de Pyth, y solo si la clave tiene acceso al feed. Sin acceso, el mercado
 * no tiene precio (el front lo muestra como "próximamente"): no se usa ninguna otra fuente.
 * Los feeds de acciones van en un stream aparte del de BTC/ETH: Hermes responde 403 a todo el stream si uno solo de los
 * ids no está habilitado, y eso no puede dejar sin precio al relayer.
 */
import type { Hex } from "viem";

import type { Candle } from "./history.js";
import type { PriceUpdate } from "./store.js";

/** Pyth publica acciones en horario extendido; sin precios nuevos por este tiempo, el mercado se toma como cerrado. */
export const PYTH_OPEN_SECONDS = 120;

/** true si la clave puede leer el feed, false si Hermes dice que no (403), null si no se pudo saber (red, 5xx). */
export async function checkEntitlement(url: string, apiKey: string | undefined, feedId: Hex): Promise<boolean | null> {
  try {
    const res = await fetch(`${url}/v2/updates/price/latest?ids[]=${feedId}&parsed=true`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    if (res.ok) return true;
    if (res.status === 401 || res.status === 403) return false;
    return null;
  } catch {
    return null;
  }
}

export type PreviewQuote = {
  price: string;
  conf: string;
  expo: number;
  publishTime: number;
  usd: number;
  marketOpen: boolean;
  previousClose: number | null;
  source: "pyth";
};

/**
 * Referencia del cambio del día: el cierre de la última vela diaria de Pyth anterior a hoy (UTC). Pyth incluye pre y
 * post-market, así que es el último precio del día anterior. null si no hay velas.
 */
export function previousCloseFrom(dailyCandles: Candle[], now = Date.now() / 1000): number | null {
  const today = Math.floor(now / 86_400) * 86_400;
  const prev = dailyCandles.filter((c) => c.t < today && Number.isFinite(c.c) && c.c > 0).at(-1);
  return prev ? prev.c : null;
}

/** Precio para el front a partir del último de Pyth; null si todavía no hay ninguno. */
export function previewQuote(pyth: PriceUpdate | undefined, previousClose: number | null, now = Date.now() / 1000): PreviewQuote | null {
  if (!pyth) return null;
  return {
    price: pyth.price.toString(),
    conf: pyth.conf.toString(),
    expo: pyth.expo,
    publishTime: pyth.publishTime,
    usd: Number(pyth.price) * 10 ** pyth.expo,
    marketOpen: now - pyth.publishTime <= PYTH_OPEN_SECONDS,
    previousClose,
    source: "pyth",
  };
}
