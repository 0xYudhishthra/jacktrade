import { useEffect, useState } from "react";

const AWAY_MS = 15_000; // Jack says something new every 15 s (browsers may slow this down in background tabs)
// Jack, the mascot, talking from the tab while you're away. Short: tab titles get cut off fast.
const PLEAS = [
  () => "Jack: hey, come back 👋",
  () => "Jack misses you",
  (coin) => `Jack: psst, ${coin} moved`,
  () => "Jack: you still there?",
  () => "Jack saved your spot",
  () => "Jack: it's quiet without you",
  (coin) => `Jack: ${coin} did a thing 👀`,
  () => "Jack: come say hi",
  () => "Jack is waiting…",
  () => "Jack: I'll be right here",
];

// The tab shows the watched market's price like a ticker. While the tab is hidden it begs the
// viewer to come back instead, in Jack's voice, with a new line every few seconds.
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
      document.title = `${coin} · JackTrade`;
      return;
    }
    const digits = price < 1 ? 4 : 2;
    const formatted = price.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    document.title = `${formatted} ${coin} · JackTrade`;
  }, [away, plea, price, coin]);
}
