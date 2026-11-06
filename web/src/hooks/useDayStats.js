import { useEffect, useMemo, useState } from "react";
import { fetchDayStats } from "@/lib/pricesApi";

const REFRESH_MS = 5 * 60_000;

// Real 24h open/high/low per market from the price service's hourly candles, refreshed every few minutes and
// stretched by the live price in between. Equity previews (SPY, TSLA) measure the change against the previous close, like
// any stock quote. A market without data yet maps to null, never to an invented figure.
export function useDayStats(symbols, quotes) {
  const [days, setDays] = useState({});
  const key = symbols.join(",");

  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      key.split(",").forEach((symbol) =>
        fetchDayStats(symbol, controller.signal)
          .then((stats) => setDays((current) => ({ ...current, [symbol]: stats })))
          .catch(() => {}),
      );
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [key]);

  return useMemo(
    () =>
      Object.fromEntries(
        key.split(",").map((symbol) => {
          const day = days[symbol];
          const quote = quotes[symbol];
          const live = Number.isFinite(quote?.usd) ? quote.usd : null;
          const reference = Number(quote?.previousClose) > 0 ? Number(quote.previousClose) : day?.open24h;
          if (!day && reference == null) return [symbol, null];
          const price = live ?? reference;
          return [
            symbol,
            {
              high24h: day ? Math.max(day.high24h, price) : null,
              low24h: day ? Math.min(day.low24h, price) : null,
              change24h: reference && price != null ? ((price - reference) / reference) * 100 : null,
            },
          ];
        }),
      ),
    [key, days, quotes],
  );
}
