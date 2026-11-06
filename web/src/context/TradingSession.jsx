import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchProfile } from "@/lib/jacktradeApi";
import { forgetWallet, restoreWallet } from "@/lib/appkit";
import { useMarketData } from "@/hooks/useMarketData";
import { useBackendAccount } from "@/hooks/useBackendAccount";
import { useLivePrices } from "@/hooks/useLivePrices";
import { useTickHistory } from "@/hooks/useTickHistory";
import { useCandleHistory } from "@/hooks/useCandleHistory";
import { useDayStats } from "@/hooks/useDayStats";
import { fetchTicks, MARKET_IDS, ALWAYS_PRICED_IDS } from "@/lib/pricesApi";
import { usePersistentState } from "@/hooks/usePersistentState";
import { useTabTitle } from "@/hooks/useTabTitle";
import { getMarkets } from "@/lib/mockMarkets";

import { TradingSessionContext } from "./TradingSessionContext";
const META = getMarkets();
const SYMBOLS = META.map((m) => m.symbol);
const TIMEFRAMES = ["tick", "1m", "5m", "15m", "1h", "4h", "1d"];

export function TradingSessionProvider({ children }) {
  // Market, view and favorites are remembered between visits (same keys as the DREAM.EXE design).
  const [savedSymbol, setSymbol] = usePersistentState("jt.dream.market", "BTC-PERP");
  const symbol = SYMBOLS.includes(savedSymbol) ? savedSymbol : "BTC-PERP";
  const [savedTimeframe, setTimeframe] = usePersistentState("jt.dream.timeframe", "tick");
  // Ignore views the backend doesn't serve (an older design offered 30m).
  const timeframe = TIMEFRAMES.includes(savedTimeframe) ? savedTimeframe : "tick";
  const [favorites, setFavorites] = usePersistentState("jt.dream.favorites", ["BTC-PERP", "ETH-PERP"]);
  const live = useLivePrices();
  // Protocol state per market (OI, caps, limits, 24h volume) from the indexer.
  const { protocolMarkets, fees, limits, marketsError } = useMarketData();
  // A closed preview market (SPY or TSLA outside trading hours) has no live ticks, so the Tick view shows 15m candles instead.
  const quote = live.quotes[symbol];
  // A preview market has history only once the price service sends its price (its Pyth feed may not be enabled yet:
  // the service answers 503). Until then nothing is fetched; once connected without a quote, it is "pending".
  const hasFeed = (s) => ALWAYS_PRICED_IDS.has(MARKET_IDS[s]) || !!live.quotes[s];
  const feedPending = live.connected && !hasFeed(symbol);
  const chartView = timeframe === "tick" && (quote?.marketOpen === false || feedPending) ? "15m" : timeframe;
  // Every market charts real candles from the price service, kept current by the websocket. Tick is live-only.
  const history = useCandleHistory(symbol, chartView, quote, chartView !== "tick" && hasFeed(symbol));
  // Backend ticks carry Pyth's publish time so live ticks line up with the backfill.
  const tickTimes = useMemo(
    () => Object.fromEntries(Object.entries(live.quotes).map(([s, q]) => [s, q.publishTime * 1000])),
    [live.quotes],
  );
  const feedSymbols = live.symbols.filter(hasFeed).join();
  const dayStats = useDayStats(useMemo(() => feedSymbols.split(","), [feedSymbols]), live.quotes);
  const [ticks, backfillTicks] = useTickHistory(live.prices, tickTimes);
  const backend = useBackendAccount(live.quotes);
  // Fill the Tick view with the backend's recent ticks on load and after every reconnect.
  useEffect(() => {
    if (!live.connected) return;
    const controller = new AbortController();
    Promise.all(
      feedSymbols.split(",").map((s) =>
        fetchTicks(s, 300, controller.signal)
          .then((list) => [s, list])
          .catch(() => [s, []]),
      ),
    ).then((entries) => {
      if (!controller.signal.aborted) backfillTicks(Object.fromEntries(entries));
    });
    return () => controller.abort();
  }, [live.connected, feedSymbols, backfillTicks]);
  const relayerMarkets = backend.account.protocol?.config?.markets;
  // Static display metadata joined with the protocol's live state. Missing backend data stays null.
  const markets = useMemo(
    () =>
      META.map((m) => {
        const protocol = protocolMarkets[m.instrumentId] ?? null;
        const relayer = relayerMarkets?.find((item) => item.id === m.instrumentId);
        const listed = !!(relayer?.listed ?? protocol?.listed);
        // An equity the Exchange hasn't listed yet is a preview: priced and charted, not tradable.
        const preview = m.kind === "equity" && !listed;
        return {
          ...m,
          protocol,
          listed,
          closed: preview,
          tradable: !preview,
          volume24h: protocol?.volume24h ?? null,
          trades24h: protocol?.trades24h ?? null,
        };
      }),
    [protocolMarkets, relayerMarkets],
  );
  const marketStatus = Object.fromEntries(
    markets.map((m) => {
      const quote = live.quotes[m.symbol];
      if (!live.connected) return [m.symbol, "offline"];
      // Equities (SPY, TSLA): closed outside market hours; a preview until listed; no quote until Pyth gives us the feed.
      if (!quote) return [m.symbol, m.closed ? "pending" : "offline"];
      if (quote.marketOpen === false) return [m.symbol, "closed"];
      if (m.closed) return [m.symbol, live.stale[m.symbol] ? "stale" : "preview"];
      if (live.stale[m.symbol]) return [m.symbol, "stale"];
      if (!m.listed) return [m.symbol, "unlisted"];
      const maxConfBps = relayerMarkets?.find((item) => item.id === m.instrumentId)?.maxConfBps ?? m.protocol?.maxConfBps;
      if (maxConfBps && live.confBps[m.symbol] > maxConfBps) return [m.symbol, "wide"];
      return [m.symbol, "live"];
    }),
  );
  // Open positions move with every price tick: the indexer's PnL (net of fees, impact and the dead zone) at its own mark,
  // plus what the live price has moved since. Re-based on each account refresh, so it never drifts.
  const account = useMemo(() => {
    const base = backend.account;
    if (!base.positions.length) return base;
    const positions = base.positions.map((p) => {
      const price = live.prices[p.symbol];
      if (!Number.isFinite(price) || !(p.entry > 0)) return p;
      const from = Number.isFinite(p.mark) ? p.mark : p.entry;
      const move = ((price - from) / p.entry) * p.notional * (p.side === "long" ? 1 : -1);
      return { ...p, mark: price, pnl: Number(p.pnl || 0) + move };
    });
    const unrealizedPnL = positions.reduce((sum, p) => sum + Number(p.pnl || 0), 0);
    return { ...base, positions, unrealizedPnL, totalEquity: base.availableMargin + base.usedMargin + unrealizedPnL };
  }, [backend.account, live.prices]);
  const walletConnected = backend.connected;
  // Reload or a new tab: reconnect the wallet the user connected last, silently, once the protocol config is loaded.
  const restoring = useRef(false);
  const configReady = !!backend.account.protocol?.config;
  useEffect(() => {
    if (!configReady || restoring.current || backend.connected) return;
    restoring.current = true;
    restoreWallet()
      .then((provider) => provider && backend.account.connect(provider))
      .catch(() => {});
  }, [configReady, backend.connected, backend.account]);
  const setWalletConnected = (next) => {
    if (next) return backend.account.connect();
    void forgetWallet();
    return backend.account.reset();
  };
  // Equity samples start once the account is loaded; no invented starting balance.
  const [equityHistory, setEquityHistory] = useState([]);

  useEffect(() => {
    if (!walletConnected) return;
    setEquityHistory((history) => {
      const sampled =
        history.length >= 240 ? history.filter((_, index) => index % 2 === 0) : history;
      return [...sampled, { time: Date.now(), value: account.totalEquity }];
    });
  }, [account.totalEquity, walletConnected]);

  // The connected wallet's public username (profiles API), shown in the header and the portfolio.
  const [profile, setProfile] = useState({ wallet: null, username: null });
  const me = backend.user?.toLowerCase() ?? null;
  useEffect(() => {
    if (!me) return;
    let active = true;
    fetchProfile(me).then((p) => active && setProfile({ wallet: me, username: p?.username ?? null })).catch(() => {});
    return () => { active = false; };
  }, [me]);
  const username = profile.wallet === me ? profile.username : null;
  const setUsername = useCallback((next) => setProfile({ wallet: me, username: next }), [me]);

  useTabTitle(symbol, live.prices[symbol]);

  const toggleFavorite = (market) =>
    setFavorites((current) =>
      current.includes(market) ? current.filter((item) => item !== market) : [...current, market],
    );
  const current = markets.find((m) => m.symbol === symbol);
  // 24h figures for the selected market: high/low/change from the price service, volume from the indexer.
  const stats = {
    high24h: dayStats[symbol]?.high24h ?? null,
    low24h: dayStats[symbol]?.low24h ?? null,
    change24h: dayStats[symbol]?.change24h ?? null,
    volume24h: current?.volume24h ?? null,
    trades24h: current?.trades24h ?? null,
  };

  return (
    <TradingSessionContext.Provider
      value={{
        markets,
        symbol,
        setSymbol,
        timeframe,
        setTimeframe,
        walletConnected,
        setWalletConnected,
        favorites,
        toggleFavorite,
        stats,
        dayStats,
        chartView,
        candles: chartView !== "tick" ? history.candles : [],
        candleStatus: feedPending ? "pending" : chartView !== "tick" ? history.status : "ready",
        candleError: history.error,
        confBps: live.confBps,
        quotes: live.quotes,
        livePrices: live.prices,
        livePrice: live.prices[symbol],
        ticks,
        marketStatus,
        feedConnected: live.connected,
        backendConfig: backend.account.protocol?.config,
        protocolMarket: current?.protocol ?? null,
        fees,
        protocolLimits: limits,
        marketsError,
        walletAddress: backend.user,
        username,
        setUsername,
        account,
        equityHistory,
      }}
    >
      {children}
    </TradingSessionContext.Provider>
  );
}
