/**
 * Muestra los precios en vivo de Hermes, una línea por segundo, y avisa si un precio se atrasa.
 *
 *   pnpm prices
 */
import { createPriceFeed, markets, toUsd } from "./index.js";

const staleSeconds = Number(process.env.PRICE_STALE_SECONDS ?? 5);
const { store, stop } = createPriceFeed({ onStatus: (s) => console.log(`[hermes] ${s}`) });

const timer = setInterval(() => {
  const now = Date.now() / 1000;
  const parts = markets.map((m) => {
    const p = store.latest(m.feedId);
    if (!p) return `${m.name} esperando…`;
    const age = now - p.publishTime;
    const confBps = (Number(p.conf) / Number(p.price)) * 10_000;
    const stale = age > staleSeconds ? " ⚠ ATRASADO" : "";
    return `${m.name} $${toUsd(p.price, p.expo).toFixed(2)} · conf ${confBps.toFixed(2)} bps · ${age.toFixed(1)} s${stale}`;
  });
  console.log(parts.join("   "));
}, 1000);

process.on("SIGINT", async () => {
  clearInterval(timer);
  await stop();
  process.exit(0);
});
