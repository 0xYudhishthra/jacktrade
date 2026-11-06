import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTradingSession } from "@/hooks/useTradingSession";
import TickChart from "@/components/trading/TickChart";
import TradingChart from "@/components/trading/TradingChart";
import { usePersistentState } from "@/hooks/usePersistentState";
import { usePolledData } from "@/hooks/useBackendAccount";
import { fetchActivity } from "@/lib/jacktradeApi";
import { Shell, useProductUI, FilterSelect } from "@/components/product/ProductUI";
import Positions from "@/components/product/Positions";
import SimplePositions from "@/components/product/SimplePositions";
import { ToolOption } from "@/components/product/ChartControls";
import Ticket from "@/components/product/Ticket";
import MarketSelector from "@/components/product/MarketSelector";
import { compact, money } from "@/lib/protocolModel";
import { previewPriceLabel } from "@/lib/pricesApi";
import { GrokBadge } from "@/components/grok/GrokUI";
import { useGrokPositionIds } from "@/lib/grok/useGrokBets";

const shortAddress = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "");
// Latest protocol trades (GET /api/activity?kind=trades), newest first, as tape/feed items. For opens `amount` is the
// margin; for closes and liquidations it is the realized PnL.
function tradeItems(activity) {
  return (activity ?? []).map((item) => {
    const market = item.market?.split("/")[0] ?? `#${item.instrumentId}`;
    const amount = Number(item.amount);
    const trader = item.username || shortAddress(item.user);
    const position = `${item.side?.toUpperCase()} ${item.leverage}× $${compact(Number(item.notional))}`;
    const kind = item.kind === "liquidation" ? "liquidations" : item.kind === "close" ? (amount > 0 ? "wins" : "losses") : "opens";
    const text =
      item.kind === "open" ? `${position}`
        : item.kind === "liquidation" ? `LIQ ${position}`
          : `${amount >= 0 ? "+" : "−"}$${money(Math.abs(amount))}`;
    const verb = { open: "opened", close: "closed", liquidation: "was liquidated on" }[item.kind] ?? item.kind;
    return {
      id: item.id,
      positionId: item.positionId == null ? null : String(item.positionId),
      market,
      kind,
      text,
      tone: item.kind === "liquidation" ? "liq" : item.kind === "open" ? "open" : amount >= 0 ? "up" : "down",
      title: `${trader} ${verb} ${position} at $${money(Number(item.price))} · ${new Date(item.at * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
      trader,
      username: item.username || item.user,
    };
  });
}
const FEED_LABELS = {
  live: ["LIVE", "Live Pyth price from the JackTrade price service"],
  stale: ["STALE", "No new price for over 5 seconds. Trading is paused for this market"],
  wide: ["WIDE", "Pyth confidence is above 10 bps. Opening positions is paused"],
  offline: ["OFFLINE", "Price service unreachable. Reconnecting"],
  unlisted: ["UNLISTED", "Live price available, but this market is not listed for trading"],
  preview: ["PREVIEW", "Preview market · Pyth price, not tradable"],
  pending: ["SOON", "Preview market · price feed coming soon, not tradable"],
  closed: ["CLOSED", "Market closed · last price, not tradable"],
};
function FeedBadge({ status, quote }) {
  const [label, defaultTitle] = FEED_LABELS[status] ?? FEED_LABELS.offline;
  const title = status === "preview" ? `Preview market · ${previewPriceLabel(quote)}, not tradable` : defaultTitle;
  return (
    <span className={`pm-feed-badge is-${["closed", "pending"].includes(status) ? "preview" : status}`} title={title}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
export default function Trade({ preview = false }) {
  const {setModal}=useProductUI();
  const {
    symbol,
    livePrice,
    stats,
    account,
    ticks,
    marketStatus,
    quotes,
    timeframe,
    chartView,
    setTimeframe,
    candles,
    candleStatus,
    candleError,
    confBps,
    protocolMarket,
  } = useTradingSession();
  const [draft, setDraft] = useState({ margin: 0, leverage: 50 });
  const [feed, setFeed] = useState("all");
  function closeWithPreview(id){setModal({type:"close",id});}
  // Tool choices are remembered between visits.
  const [showRisk, setShowRisk] = usePersistentState("hm.tools.risk", true);
  const [showOI, setShowOI] = usePersistentState("hm.tools.oi", false);
  const [showFeed, setShowFeed] = usePersistentState("hm.tools.feed", false);
  const [expandedPositions, setExpandedPositions] = usePersistentState("hm.tools.positions", false);
  // Global trades from the indexer for the tape and the feed, polled every 4 s.
  const activity = usePolledData("trades", () => fetchActivity({ kind: "trades", limit: 30 }), 4_000);
  const trades = useMemo(() => tradeItems(activity.data?.items), [activity.data]);
  const grokIds = useGrokPositionIds();
  // Open interest and caps from GET /api/markets; preview markets have none.
  const longs = protocolMarket?.longOi ?? null;
  const shorts = protocolMarket?.shortOi ?? null;
  const oi = longs == null || shorts == null ? null : longs + shorts;
  const usd = (n) => (n == null ? "—" : `$${compact(n)}`);
  const lines = [
    ...(draft.margin > 0
      ? [
          { price: livePrice, label: "ENTRY", color: "#254a87" },
          { price: draft.liq, label: "LIQ", color: "#c85c67" },
          ...(draft.tp ? [{ price: draft.tp, label: "TP", color: "#2d9562" }] : []),
          ...(draft.sl ? [{ price: draft.sl, label: "SL", color: "#c85c67" }] : []),
        ]
      : []),
    ...account.positions
      .filter((p) => p.symbol === symbol)
      .flatMap((p) => [
        { price: p.entry, label: `YOUR ${p.side.toUpperCase()} ${p.leverage}×`, color: "#254a87" },
        { price: p.liq, label: "YOUR LIQ", color: "#c85c67" },
        ...(p.tp ? [{ price: p.tp, label: "YOUR TP", color: "#2d9562" }] : []),
        ...(p.sl ? [{ price: p.sl, label: "YOUR SL", color: "#c85c67" }] : []),
      ]),
    // A liquidation is marked only while it is recent: an old one is a stray line far from the price.
    ...account.history
      .filter((p) => p.symbol === symbol && p.liquidated && Date.now() - p.time < 15 * 60_000)
      .slice(0, 3)
      .map((p) => ({ price: p.exit, label: "LIQ HIT", color: "#c85c67" })),
  ].filter((line) => Number.isFinite(line.price));
  const chartHeader = (
    <>
      <MarketSelector />
      <dl
        className="pm-floating-market-stats"
        aria-label="Live protocol market statistics"
        title="Market data from the JackTrade indexer"
      >
        <div>
          <dt>Vol 24h</dt>
          <dd>{usd(stats.volume24h)}</dd>
        </div>
        <div>
          <dt>Long OI</dt>
          <dd>{usd(longs)}</dd>
        </div>
        <div>
          <dt>Short OI</dt>
          <dd>{usd(shorts)}</dd>
        </div>
      </dl>
    </>
  );
  const chartStatus = (
    <div className="pm-chart-feed-status">
      {/* Preview markets are not tradable: no confidence chip. */}
      {confBps[symbol] !== undefined && !["preview", "closed", "pending"].includes(marketStatus[symbol]) && (
        <span
          className={`pm-feed-conf ${confBps[symbol] > 10 ? "is-wide" : ""}`}
          title="Pyth confidence. Above 10 bps the contracts reject new positions."
        >
          conf {confBps[symbol].toFixed(1)} bps
        </span>
      )}
      <FeedBadge status={marketStatus[symbol]} quote={quotes?.[symbol]} />
    </div>
  );
  const longPct = oi ? Math.round((longs / oi) * 100) : 50;
  const oiLimit = protocolMarket?.longOiCap && protocolMarket?.shortOiCap ? protocolMarket.longOiCap + protocolMarket.shortOiCap : null;
  const capacityPct = oiLimit && oi != null ? Math.min(100, (oi / oiLimit) * 100) : 0;
  const chartExtras = showOI && (
    <section className="pm-oi-card" aria-label={`${symbol} open interest`}>
      <header>
        <b>Open interest</b>
        <span>protocol · {symbol}</span>
        <strong>{usd(oi)}</strong>
      </header>
      <div
        className="pm-oi-split"
        role="img"
        aria-label={`Longs ${longPct} percent, shorts ${100 - longPct} percent`}
      >
        <i className="is-long" style={{ width: `${longPct}%` }} />
        <i className="is-short" style={{ width: `${100 - longPct}%` }} />
      </div>
      <div className="pm-oi-legend">
        <span className="pm-up">
          Longs {usd(longs)}{oi ? ` · ${longPct}%` : ""}
        </span>
        <span className="pm-down">
          {oi ? `${100 - longPct}% · ` : ""}{usd(shorts)} Shorts
        </span>
      </div>
      <div className="pm-oi-capacity">
        <span>Capacity</span>
        <div
          className="pm-oi-capacity-bar"
          role="img"
          aria-label={`${Math.round(capacityPct)} percent of the open interest limit used`}
        >
          <i style={{ width: `${capacityPct}%` }} />
        </div>
        <span>
          {oiLimit ? `$${compact(Math.max(0, oiLimit - (oi ?? 0)))} left of $${compact(oiLimit)}` : "No cap set — market not listed"}
        </span>
      </div>
    </section>
  );
  const fmtStat = (n) =>
    n == null ? "—" : n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: n >= 1000 ? 2 : 4,
    });
  const chartTools = (
    <>
      <fieldset>
        <legend>On the chart</legend>
        <ToolOption
          label="Entry & liquidation lines"
          description="Where your order would open and where it would be liquidated"
          checked={showRisk}
          onChange={setShowRisk}
        />
        <ToolOption
          label="Open interest"
          description="Live long vs short exposure and remaining protocol capacity"
          checked={showOI}
          onChange={setShowOI}
        />
      </fieldset>
      <fieldset>
        <legend>Below the chart</legend>
        <ToolOption
          label="Trades feed"
          description="Latest opens, closes and liquidations across JackTrade"
          checked={showFeed}
          onChange={setShowFeed}
        />
        <ToolOption
          label="Detailed positions"
          description="Full table with entry, mark, liquidation and PnL"
          checked={expandedPositions}
          onChange={setExpandedPositions}
        />
      </fieldset>
      <fieldset>
        <legend>
          {symbol} · 24h
        </legend>
        <dl className="pm-chart-market-stats">
          <div>
            <dt>High</dt>
            <dd>{fmtStat(stats.high24h)}</dd>
          </div>
          <div>
            <dt>Low</dt>
            <dd>{fmtStat(stats.low24h)}</dd>
          </div>
          <div>
            <dt>Change</dt>
            <dd className={stats.change24h == null ? undefined : stats.change24h >= 0 ? "pm-up" : "pm-down"}>
              {stats.change24h == null ? "—" : `${stats.change24h >= 0 ? "+" : ""}${stats.change24h.toFixed(2)}%`}
            </dd>
          </div>
          <div>
            <dt>Volume</dt>
            <dd>{usd(stats.volume24h)}</dd>
          </div>
          <div>
            <dt>Trades</dt>
            <dd>{stats.trades24h ?? "—"}</dd>
          </div>
          {confBps[symbol] !== undefined && !["preview", "closed", "pending"].includes(marketStatus[symbol]) && (
            <div>
              <dt>Pyth confidence</dt>
              <dd className={confBps[symbol] > 10 ? "pm-warn" : ""}>
                {confBps[symbol].toFixed(1)} bps
              </dd>
            </div>
          )}
          <div>
            <dt>Max leverage</dt>
            <dd>{protocolMarket?.maxLeverage ? `${protocolMarket.maxLeverage.toLocaleString("en-US")}×` : "—"}</dd>
          </div>
        </dl>
      </fieldset>
    </>
  );
  const chartMessage =
    candleStatus === "pending"
      ? `${symbol.replace("-PERP", "")} price feed coming soon.`
      : candleStatus === "loading"
      ? "Loading price history…"
      : candleStatus === "error"
        ? `Couldn't load price history (${candleError}). Pick a timeframe to retry.`
        : null;
  return (
    <Shell trade>
      <div className="hm-focus-layout pm-simple-trade">
        <section aria-label="Price chart" className="hm-focus-chart-column">
          <div className="hm-focus-chart">
            {chartView === "tick" ? (
              <TickChart
                motionPreference={preview ? "app" : "system"}
                symbol={symbol}
                ticks={ticks[symbol]}
                status={marketStatus[symbol]}
                header={chartHeader}
                headerEnd={chartStatus}
                overlayExtras={chartExtras}
                riskLines={showRisk ? lines : undefined}
                tools={chartTools}
                timeframe={timeframe}
                onTimeframe={setTimeframe}
              />
            ) : (
              <TradingChart
                symbol={symbol}
                candles={candles}
                timeframe={chartView}
                onTimeframe={setTimeframe}
                header={chartHeader}
                headerEnd={chartStatus}
                overlayExtras={chartExtras}
                riskLines={showRisk ? lines : undefined}
                tools={chartTools}
                message={chartMessage}
              />
            )}
          </div>
        </section>
        <aside className="hm-focus-order" aria-label="Order controls">
          <div className="hm-focus-order-entry">
            <Ticket onDraft={setDraft} />
          </div>
        </aside>
      </div>
      {showFeed && (
        <div className="pm-feed">
          <div>
            <span>GLOBAL / LIVE</span>
            <FilterSelect
              label="Trade feed filter"
              value={feed}
              onChange={setFeed}
              items={[["all", "All trades"], ["opens", "Opens"], ["wins", "Closed in profit"], ["losses", "Closed at a loss"], ["liquidations", "Liquidations"]]}
            />
          </div>
          {trades.filter((x) => feed === "all" || x.kind === feed).map((x) => (
            <Link
              key={x.id}
              to="/u/$username"
              params={{ username: x.username }}
              className={x.tone === "up" ? "pm-up" : x.tone === "open" ? undefined : "pm-down"}
              title={x.title}
            >
              <span>{x.market}</span> {x.text}
              {x.positionId && grokIds.has(x.positionId) && <GrokBadge />}
              <small>{x.trader} ↗</small>
            </Link>
          ))}
          {!trades.some((x) => feed === "all" || x.kind === feed) && (
            <span>{activity.error ? `Trades unavailable (${activity.error})` : activity.data ? "No trades yet" : "Loading trades…"}</span>
          )}
        </div>
      )}
      <SimplePositions
        detailedPositions={expandedPositions ? <Positions hideTabs embedded /> : null}
        positions={account.positions}
        onClose={closeWithPreview}
        history={account.history}
        unrealizedPnL={account.unrealizedPnL}
      />
    </Shell>
  );
}
