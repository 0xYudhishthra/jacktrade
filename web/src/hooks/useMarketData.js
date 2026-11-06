import { useMemo } from "react";
import { usePolledData } from "@/hooks/useBackendAccount";
import { fetchApiConfig, fetchMarkets } from "@/lib/jacktradeApi";

const MARKETS_MS = 10_000;
const CONFIG_MS = 60_000;

const num = (value) => (value == null ? null : Number(value));
// A market that is not listed reads its on-chain limits as zeros: treat those as unknown, not as real limits.
const positive = (value) => (Number(value) > 0 ? Number(value) : null);

/**
 * Protocol state per market from the indexer, keyed by instrumentId: GET /api/markets (price, OI, caps, 24h volume,
 * listed) merged with GET /api/config (leverage, liquidation buffer, size limits, impact) and the protocol fees.
 */
export function useMarketData() {
  const markets = usePolledData("markets", fetchMarkets, MARKETS_MS);
  const config = usePolledData("config", fetchApiConfig, CONFIG_MS);

  const byId = useMemo(() => {
    const limits = new Map((config.data?.markets ?? []).map((m) => [m.instrumentId, m]));
    return Object.fromEntries((markets.data ?? []).map((m) => {
      const cfg = limits.get(m.instrumentId) ?? {};
      return [m.instrumentId, {
        instrumentId: m.instrumentId,
        name: m.name,
        listed: !!m.listed && !m.retired,
        retired: !!m.retired,
        price: num(m.price),
        longOi: num(m.longOi),
        shortOi: num(m.shortOi),
        longOiCap: positive(m.longOiCap ?? cfg.longOiCap),
        shortOiCap: positive(m.shortOiCap ?? cfg.shortOiCap),
        volume24h: num(m.volume24h),
        trades24h: m.trades24h ?? null,
        maxLeverage: positive(m.maxLeverage ?? cfg.maxLeverage),
        // 0 bps is a valid buffer on a listed market, so only an unlisted one reads as unknown.
        liqBufferBps: m.listed ? Number(m.liqBufferBps ?? cfg.liqBufferBps ?? 0) : null,
        maxConfBps: positive(m.maxConfBps ?? cfg.maxConfBps),
        minMargin: positive(m.minMargin ?? cfg.minMargin),
        minNotional: positive(m.minNotional ?? cfg.minNotional),
        maxNotional: positive(m.maxNotional ?? cfg.maxNotional),
        impact: cfg.impact ?? null,
      }];
    }));
  }, [markets.data, config.data]);

  return {
    protocolMarkets: byId,
    fees: config.data?.fees ?? null,
    limits: config.data?.limits ?? null,
    marketsError: markets.error || config.error,
  };
}
