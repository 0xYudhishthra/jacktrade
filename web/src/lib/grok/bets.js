// Helpers shared by the agent bets feed and Make it real.
export function marketSymbol(market) {
  return String(market ?? "")
    .toUpperCase()
    .replace(/[-_ ]?\/?USDG?$/, "")
    .replace(/-PERP$/, "")
    .replace(/\/.*$/, "")
    .trim();
}

export const isLong = (side) => /^(long|buy|true)$/i.test(String(side));
