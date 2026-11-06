import { Link } from "@tanstack/react-router";
import { useTradingSession } from "@/hooks/useTradingSession";
import { usePolledData } from "@/hooks/useBackendAccount";
import { fetchLeaderboardAccounts } from "@/lib/jacktradeApi";
import { RELAYER_URL } from "@/lib/backend";
import { bpsPercent, money } from "@/lib/protocolModel";
import { previewPriceLabel } from "@/lib/pricesApi";

const shortAddress = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "");
const signed = (n) => `${n >= 0 ? "+" : "−"}$${money(Math.abs(n))}`;

// Top five accounts of the last 24 hours from the indexer leaderboard (GET /api/leaderboard/accounts).
export function TradeLeaderboard() {
  const { data, error } = usePolledData("leaderboard-24h", () => fetchLeaderboardAccounts({ window: "24h" }), 30_000);
  const leaders = (data?.accounts ?? []).slice(0, 5);
  return (
    <div className="pd-trade-leaders">
      <div className="pd-trade-view-actions">
        <span>Top accounts · 24h</span>
        <Link to="/leaderboard">Full leaderboard ↗</Link>
      </div>
      <table className="pm-table">
        <thead><tr>{["#", "Trader", "PnL", "Return", "Trades", "Win rate"].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{leaders.map((trader) => {
          const pnl = Number(trader.pnl);
          const tone = pnl >= 0 ? "pm-up" : "pm-down";
          return (
            <tr key={trader.user}>
              <td>{trader.rank}</td>
              <td><Link to="/u/$username" params={{ username: trader.username || trader.user }}>{trader.username || shortAddress(trader.user)}</Link></td>
              <td className={tone}>{signed(pnl)}</td>
              <td className={tone}>{trader.roi == null ? "—" : `${trader.roi >= 0 ? "+" : ""}${Number(trader.roi).toFixed(2)}%`}</td>
              <td>{trader.trades}</td><td>{trader.winRate == null ? "—" : `${trader.winRate}%`}</td>
            </tr>
          );
        })}</tbody>
      </table>
      {!leaders.length && (
        <div className="pm-empty">{error ? `Leaderboard unavailable (${error}).` : data ? "No trades in the last 24h yet." : "Loading…"}</div>
      )}
    </div>
  );
}

// The relayer's own health check: 200 { live: true } when it can submit, 503 with the reasons when it can't.
async function fetchRelayerLive() {
  const response = await fetch(`${RELAYER_URL}/live`);
  const body = await response.json().catch(() => null);
  if (!body || typeof body.live !== "boolean") throw new Error(`HTTP ${response.status}`);
  return body;
}

export function TradeStatus() {
  const { account, walletConnected, walletAddress, markets, symbol, marketStatus, quotes, feedConnected, protocolMarket, fees, backendConfig } = useTradingSession();
  const relayer = usePolledData("relayer-live", fetchRelayerLive, 15_000);
  const now = Date.now();
  const status = marketStatus[symbol];
  const feed = {
    live: "Pyth · receiving prices",
    stale: "Pyth · stale prices",
    wide: "Pyth · confidence too wide",
    offline: "Offline",
    unlisted: "Pyth · market not listed yet",
    preview: `Preview · ${previewPriceLabel(quotes?.[symbol])}`,
    closed: "Preview · market closed",
    pending: "Preview · price feed coming soon",
  }[status] || "Unavailable";
  const engine = relayer.data
    ? relayer.data.live ? "Relayer · live" : `Relayer · not live${relayer.data.reasons?.length ? ` (${relayer.data.reasons.join(", ")})` : ""}`
    : relayer.error ? `Relayer · unreachable (${relayer.error})` : "Checking…";
  const winFee = bpsPercent(fees?.winFeeBps);
  const rows = [
    ["Engine", engine],
    ["Trading", backendConfig ? backendConfig.tradingPaused ? "Paused by the protocol" : "Active" : "—"],
    ["Price feed", `${symbol} · ${feed}`],
    ["Price service", feedConnected ? "Connected" : "Disconnected"],
    ["Markets", markets.map(market => `${market.symbol.replace("-PERP", "")}${market.closed ? " (preview)" : market.listed ? "" : " (not listed)"}`).join(" · ")],
    ["Connection", walletConnected ? `Wallet ${shortAddress(walletAddress)}` : "Not connected"],
    ["Session", account.pauseUntil > now ? "Trading pause active"
      : account.sessionUntil > now ? `Until ${new Date(account.sessionUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Inactive"],
    ["Max leverage", protocolMarket?.maxLeverage ? `${protocolMarket.maxLeverage.toLocaleString("en-US")}×` : "—"],
    ["Win fee", winFee ? `${winFee} of realized profit + size-based impact` : "—"],
    ["Queued payouts", walletConnected ? `${account.queue.length} · $${money(account.queue.reduce((sum, item) => sum + item.amount, 0))}` : "—"],
  ];
  return (
    <dl className="pd-trade-status">
      {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}
