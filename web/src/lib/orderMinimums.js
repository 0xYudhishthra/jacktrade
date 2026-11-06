// Frontend floors for an order; a market's own limits (GET /api/config) win when they are stricter.
export const MIN_MARGIN = 10;
export const MIN_POSITION_SIZE = 1_000;

export function orderMinimums(market) {
  return {
    margin: Math.max(MIN_MARGIN, Number(market?.minMargin) || 0),
    positionSize: Math.max(MIN_POSITION_SIZE, Number(market?.minNotional) || 0),
    // The protocol's cap per position; null when the market doesn't report one.
    maxPositionSize: Number(market?.maxNotional) > 0 ? Number(market.maxNotional) : null,
  };
}

export function orderMinimumIssue(margin, leverage, market) {
  const minimums = orderMinimums(market);
  if (!Number.isFinite(margin) || margin < minimums.margin) {
    return { kind: "margin", minimum: minimums.margin };
  }
  if (!Number.isFinite(leverage) || margin * leverage < minimums.positionSize) {
    return { kind: "position", minimum: minimums.positionSize };
  }
  if (minimums.maxPositionSize != null && margin * leverage > minimums.maxPositionSize) {
    return { kind: "maxPosition", maximum: minimums.maxPositionSize };
  }
  return null;
}
