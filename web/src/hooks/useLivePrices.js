import { useEffect, useMemo, useState } from "react";
import { FEED_SYMBOLS, PRICES_WS_URL, SYMBOLS } from "@/lib/pricesApi";

// Live Pyth prices from the backend price service (see backend docs/precios-front.md).
const STALE_SECONDS = 5;
const PREVIEW_STALE_SECONDS = 120;

export function useLivePrices() {
  const [quotes, setQuotes] = useState({});
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let ws;
    let retry;
    let closed = false;
    let attempts = 0;

    function connect() {
      ws = new WebSocket(PRICES_WS_URL);
      ws.onopen = () => { attempts = 0; setConnected(true); };
      ws.onclose = () => {
        setConnected(false);
        // 1 s, 2 s, 4 s… up to 30 s, with jitter: a prices outage must not make every tab reconnect every second.
        attempts += 1;
        if (!closed) retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempts - 1, 5)) * (0.75 + Math.random() / 2));
      };
      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        const list = msg?.type === "snapshot" ? (Array.isArray(msg.prices) ? msg.prices : []) : [msg];
        setQuotes((prev) => {
          const next = { ...prev };
          for (const p of list) {
            const symbol = SYMBOLS[p.market];
            if (symbol) next[symbol] = p;
          }
          return next;
        });
      };
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  // Re-render every second so a price that stops updating is flagged as stale.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Memoized so consumers only see a new object when a new price arrives.
  const prices = useMemo(
    () => Object.fromEntries(Object.entries(quotes).map(([s, p]) => [s, p.usd])),
    [quotes],
  );
  const confBps = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(quotes).map(([s, p]) => [s, (Number(p.conf) / Number(p.price)) * 10_000]),
      ),
    [quotes],
  );
  const stale = useMemo(
    () =>
      Object.fromEntries(
        // Preview markets (SPY, TSLA) stop outside trading hours: stale only if no update for 2 min while open.
        Object.entries(quotes).map(([s, p]) => [s, p.preview ? p.marketOpen && now / 1000 - p.publishTime > PREVIEW_STALE_SECONDS : now / 1000 - p.publishTime > STALE_SECONDS]),
      ),
    [quotes, now],
  );

  return { connected, prices, stale, confBps, quotes, symbols: FEED_SYMBOLS };
}
