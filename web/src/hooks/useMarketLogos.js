import { useEffect, useState } from "react";
import { getMarkets } from "@/lib/mockMarkets";

const COINGECKO_MARKETS = "https://api.coingecko.com/api/v3/coins/markets";
const CACHE_KEY = "hm-market-logos-v2";
// Collateral on Robinhood Chain is USDG (Global Dollar), fetched alongside the market logos.
export const COLLATERAL = { symbol: "USDG", coingeckoId: "global-dollar", glyph: "$" };
const CACHE_TTL = 24 * 60 * 60 * 1000;
let request = null;

// The public API rate-limits per visitor, so resolved URLs are kept for a day.
function readCache() {
  try {
    const cached = JSON.parse(window.localStorage.getItem(CACHE_KEY));
    return cached && Date.now() - cached.at < CACHE_TTL ? cached.logos : null;
  } catch {
    return null;
  }
}
function writeCache(logos) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), logos }));
  } catch {
    // Not cached; the next visit fetches again.
  }
}

// Crypto and collateral logos come from CoinGecko, equity logos from a fixed URL. Fetched once per page load;
// on any failure the markets simply keep their text glyphs.
function fetchLogos() {
  if (request) return request;
  const markets = getMarkets();
  const direct = Object.fromEntries(
    markets.filter((m) => m.logoUrl).map((m) => [m.symbol, m.logoUrl]),
  );
  // Fixed URLs never come from the cache, so a market added later still gets its logo.
  const cached = readCache();
  if (cached) return (request = Promise.resolve({ ...cached, ...direct }));
  const coins = [...markets.filter((m) => m.coingeckoId), COLLATERAL];
  const ids = coins.map((m) => m.coingeckoId).join(",");
  request = fetch(`${COINGECKO_MARKETS}?vs_currency=usd&ids=${ids}`)
    .then((response) => (response.ok ? response.json() : []))
    .then((rows) => {
      const images = Object.fromEntries(rows.map((row) => [row.id, row.image]));
      const fetched = coins
        .filter((m) => images[m.coingeckoId])
        .map((m) => [m.symbol, images[m.coingeckoId].replace("/large/", "/small/")]);
      const logos = { ...direct, ...Object.fromEntries(fetched) };
      if (fetched.length === coins.length) writeCache(logos);
      return logos;
    })
    .catch(() => direct);
  return request;
}

export function useMarketLogos() {
  const [logos, setLogos] = useState({});
  useEffect(() => {
    let live = true;
    fetchLogos().then((next) => live && setLogos(next));
    return () => {
      live = false;
    };
  }, []);
  return logos;
}
