import { useEffect, useState } from "react";

const AWAY_MS = 60_000; // a new plea every minute
const PLEAS = [
  (coin) => `🥺 come back… · ${coin}`,
  () => "(╥﹏╥) the chart misses you",
  (coin) => `👀 ${coin} moved. just saying`,
  () => "🥹 your leverage is lonely",
  () => "(｡•́︿•̀｡) one more trade?",
  () => "😢 we kept your seat warm",
  () => "🕯️ the house is waiting…",
  (coin) => `🥺 ${coin} asked about you`,
];

// The tab shows the watched market's price like a ticker. While the tab is hidden it begs the
// viewer to come back instead, with a new message every minute.
export function useTabTitle(symbol, price) {
  const [away, setAway] = useState(() => document.hidden);
  const [plea, setPlea] = useState(0);
  const coin = symbol.replace("-PERP", "");

  useEffect(() => {
    const onVisibility = () => setAway(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!away) return;
    setPlea(Math.floor(Math.random() * PLEAS.length));
    const id = setInterval(() => setPlea((n) => (n + 1) % PLEAS.length), AWAY_MS);
    return () => clearInterval(id);
  }, [away]);

  useEffect(() => {
    if (away) {
      document.title = PLEAS[plea](coin);
      return;
    }
    if (!Number.isFinite(price)) {
      document.title = `${coin} · jacktrade`;
      return;
    }
    const digits = price < 1 ? 4 : 2;
    const formatted = price.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    document.title = `${formatted} ${coin} · jacktrade`;
  }, [away, plea, price, coin]);
}
