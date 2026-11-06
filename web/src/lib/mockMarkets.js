// Display metadata for the JACKTRADE markets (ticker, name, logo, colors, decimals). Prices, open interest, limits
// and volume come from the backend; nothing here is market data.
import { MARKET_IDS } from "./pricesApi.js";

const MARKETS = [
  { symbol: "BTC-PERP", name: "Bitcoin", glyph: "₿", coingeckoId: "bitcoin", color: "#F7931A", decimals: 2 },
  { symbol: "ETH-PERP", name: "Ethereum", glyph: "Ξ", coingeckoId: "ethereum", color: "#627EEA", decimals: 2 },
  // SPY and TSLA: Pyth price during US market hours. Tradable once the Exchange lists them; until then, preview only.
  {
    symbol: "SPY-PERP",
    name: "S&P 500 ETF · equity",
    glyph: "S",
    logoUrl: "https://financialmodelingprep.com/image-stock/SPY.png",
    color: "#9d94b3",
    decimals: 2,
    kind: "equity",
  },
  {
    symbol: "TSLA-PERP",
    name: "Tesla · equity",
    glyph: "T",
    logoUrl: "https://financialmodelingprep.com/image-stock/TSLA.png",
    color: "#e31937",
    decimals: 2,
    kind: "equity",
  },
].map((m) => ({ ...m, instrumentId: MARKET_IDS[m.symbol] }));

export function getMarkets() {
  return MARKETS;
}

export const marketBySymbol = (symbol) => MARKETS.find((m) => m.symbol === symbol);
export const instrumentIdFor = (symbol) => MARKET_IDS[symbol];
