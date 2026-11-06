// Product choices for the leverage control (not protocol limits): a 10× floor in 10× steps. The maximum leverage,
// fees, size limits and liquidation buffer always come from the backend (GET /api/config, /api/markets).
export const LEVERAGE = { min: 10, step: 10, default: 50 };

// Liquidation price as the contracts compute it: the move that eats the margin, less the market's buffer.
// dist = entry / leverage − entry × liqBufferBps / 10 000; long: entry − dist, short: entry + dist.
// Null while the buffer or the price is unknown.
export function liquidationPrice(side, entry, leverage, liqBufferBps) {
  if (!Number.isFinite(entry) || !(leverage > 0) || liqBufferBps == null || !Number.isFinite(Number(liqBufferBps))) return null;
  const dist = Math.max(0, entry / leverage - (entry * Number(liqBufferBps)) / 10_000);
  return side === "long" ? entry - dist : entry + dist;
}

// "2%" from 200 bps, or null when the backend hasn't answered.
export const bpsPercent = (bps) =>
  bps == null ? null : `${(Number(bps) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

// USDG rewards: cents like any amount, but fractions of a cent (early staker rewards) keep 4 decimals.
export const rewardUsd = (n) => {
  const v = Number(n || 0);
  return `$${money(v, v !== 0 && Math.abs(v) < 0.01 ? 4 : 2)}`;
};

export const money = (n, digits = 2) =>
  Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
export const compact = (n) =>
  Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n || 0);
