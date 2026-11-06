import { useCallback, useEffect, useState } from "react";

const MAX_AGE_MS = 5 * 60_000; // the chart shows one minute; keep a little extra
const NO_TIMES = {};

// Builds a per-market tick series from whatever prices arrive. `times` gives each price its
// source timestamp in ms (Pyth publishTime for backend markets); others use arrival time.
// `backfill` merges ticks fetched from the backend so the series doesn't start empty.
export function useTickHistory(prices, times = NO_TIMES) {
  const [history, setHistory] = useState({});

  useEffect(() => {
    const arrival = Date.now();
    setHistory((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [symbol, price] of Object.entries(prices)) {
        if (!Number.isFinite(price)) continue;
        const series = prev[symbol] ?? [];
        const last = series.at(-1);
        const time = times[symbol] ?? arrival;
        if (last && (last.price === price || time <= last.time)) continue;
        next[symbol] = [...series.filter((t) => time - t.time < MAX_AGE_MS), { time, price }];
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [prices, times]);

  const backfill = useCallback((bySymbol) => {
    setHistory((prev) => {
      const next = { ...prev };
      for (const [symbol, fetched] of Object.entries(bySymbol)) {
        if (fetched.length === 0) continue;
        const newer = (prev[symbol] ?? []).filter((t) => t.time > fetched.at(-1).time);
        next[symbol] = [...fetched, ...newer];
      }
      return next;
    });
  }, []);

  return [history, backfill];
}
