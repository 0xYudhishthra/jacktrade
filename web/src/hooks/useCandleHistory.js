import { useEffect, useState } from "react";
import { fetchCandles, INTERVAL_SECONDS } from "@/lib/pricesApi";

const MAX_CANDLES = 500;

// Real candles from the backend for one market and interval, kept current with live ticks:
// each websocket price updates the open candle, or opens the next one when it crosses into a
// new interval. Refetches whenever the market or interval changes.
export function useCandleHistory(symbol, interval, quote, enabled) {
  const key = `${symbol}:${interval}`;
  const [state, setState] = useState({ key: null, status: "idle", candles: [], error: null });

  useEffect(() => {
    if (!enabled || !INTERVAL_SECONDS[interval]) return;
    const controller = new AbortController();
    setState({ key, status: "loading", candles: [], error: null });
    fetchCandles(symbol, interval, controller.signal)
      .then((candles) => setState({ key, status: "ready", candles, error: null }))
      .catch((error) => {
        if (!controller.signal.aborted) setState({ key, status: "error", candles: [], error: error.message });
      });
    return () => controller.abort();
  }, [key, symbol, interval, enabled]);

  const price = quote?.usd;
  const publishTime = quote?.publishTime;
  useEffect(() => {
    if (!enabled || price === undefined || publishTime === undefined) return;
    const step = INTERVAL_SECONDS[interval] * 1000;
    const time = publishTime * 1000;
    setState((current) => {
      if (current.key !== key || current.status !== "ready" || current.candles.length === 0) return current;
      const last = current.candles.at(-1);
      if (time < last.t) return current;
      if (time >= last.t + step) {
        const open = { t: Math.floor(time / step) * step, o: price, h: price, l: price, c: price, v: 0 };
        return { ...current, candles: [...current.candles.slice(-(MAX_CANDLES - 1)), open] };
      }
      const updated = { ...last, c: price, h: Math.max(last.h, price), l: Math.min(last.l, price) };
      return { ...current, candles: [...current.candles.slice(0, -1), updated] };
    });
  }, [price, publishTime, key, interval, enabled]);

  if (!enabled) return { candles: [], status: "idle", error: null };
  if (state.key !== key) return { candles: [], status: "loading", error: null };
  return state;
}
