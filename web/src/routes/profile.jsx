import { useEffect, useState } from "react";
import { useParams, Link } from "@tanstack/react-router";
import { PageHead } from "@/components/grok/GrokUI";
import { useTradingSession } from "@/hooks/useTradingSession";
import { Shell, Panel, FilterSelect, useProductUI } from "@/components/product/ProductUI";
import { StatRows } from "@/components/product/DashboardChart";
import { API_WINDOW, isAddress, pnlChartSeries, shortAddress, tradeSummary } from "@/lib/dashboardData";
import PortfolioDetails from "@/components/product/PortfolioDetails";
import { ChartTools, SnapshotChart } from "@/components/product/DashboardTools";
import { money, compact, rewardUsd } from "@/lib/protocolModel";
import { API_URL, requestJson } from "@/lib/backend";
import { fetchPnlSeries, fetchProfile, fetchProfileByUsername } from "@/lib/jacktradeApi";

// /portfolio (the connected wallet) and /u/:username (anyone). Every number comes from the indexer API.
const HISTORY_PAGES = 10;

// /u/:name -> { user, username }. A name nobody owns is "not found", unless it is a wallet address.
async function resolveProfile(name) {
  if (isAddress(name)) {
    const profile = await fetchProfile(name.toLowerCase()).catch(() => null);
    return { user: name.toLowerCase(), username: profile?.username ?? null };
  }
  try {
    const profile = await fetchProfileByUsername(name);
    return { user: profile.wallet, username: profile.username };
  } catch (error) {
    if (error.code === "PROFILE_NOT_FOUND" || error.status === 404) return null;
    throw error;
  }
}

async function loadPublicAccount(user) {
  const get = (path) => requestJson(`${API_URL}${path}`);
  const [account, positions] = await Promise.all([get(`/api/account/${user}`), get(`/api/positions/${user}`)]);
  const history = [];
  let cursor = null;
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const body = await get(`/api/history/${user}${cursor ? `?cursor=${cursor}` : ""}`);
    history.push(...body.items);
    if (!body.next) break;
    cursor = body.next;
  }
  return { account, positions, history };
}

function badgesFor({ trades, staked, liquidations }) {
  return [
    trades > 0 && "↗ FIRST TRADE",
    staked > 0 && "屋 HOUSE OWNER",
    liquidations > 0 && "✦ SURVIVOR",
  ].filter(Boolean);
}

export default function Profile() {
  const { username } = useParams({ strict: false });
  const { account, walletAddress, username: ownUsername, setUsername: setOwnUsername } = useTradingSession();
  const { setModal } = useProductUI();
  const [paused, setPaused] = useState(false);
  const [range, setRange] = useState("all");
  const [chartMetric, setChartMetric] = useState("equity");
  const me = walletAddress?.toLowerCase() ?? null;


  // /u/:username -> wallet.
  const [resolved, setResolved] = useState({ name: null, status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!username) return;
    let live = true;
    setResolved({ name: username, status: "loading" });
    resolveProfile(username)
      .then((found) => live && setResolved(found ? { name: username, status: "ready", ...found } : { name: username, status: "notfound" }))
      .catch((error) => live && setResolved({ name: username, status: "error", error: error.message }));
    return () => { live = false; };
  }, [username, attempt]);
  const resolving = username && (resolved.name !== username || resolved.status === "loading");
  const publicUser = username && resolved.name === username && resolved.status === "ready" ? resolved.user : null;
  const isPublic = !!username && publicUser !== me;

  // Public account: stats, open positions and closed history.
  const [remote, setRemote] = useState({ user: null });
  useEffect(() => {
    if (!isPublic || !publicUser) return;
    let live = true;
    loadPublicAccount(publicUser)
      .then((data) => live && setRemote({ user: publicUser, ...data }))
      .catch((error) => live && setRemote({ user: publicUser, error: error.message }));
    return () => { live = false; };
  }, [isPublic, publicUser, attempt]);

  // Equity / realized PnL over time (GET /api/pnl/:user). Reloads after each new trade or transfer on the own account.
  const chartUser = isPublic ? publicUser : me;
  const apiWindow = API_WINDOW[range] ?? "all";
  const [pnl, setPnl] = useState({ key: null });
  const pnlKey = chartUser ? `${chartUser}:${apiWindow}` : null;
  const ownEvents = isPublic ? 0 : account.history.length;
  useEffect(() => {
    if (!pnlKey) return;
    let live = true;
    fetchPnlSeries(chartUser, apiWindow)
      .then((data) => live && setPnl({ key: pnlKey, data }))
      .catch((error) => live && setPnl({ key: pnlKey, error: error.message }));
    return () => { live = false; };
  }, [pnlKey, chartUser, apiWindow, ownEvents]);

  if (username && resolved.name === username && resolved.status === "notfound")
    return (
      <Shell title="Profile not found." subtitle={`No JackTrade profile uses the name “${username}”.`}>
        <Link className="luna-btn pm-back" to="/leaderboard">Back to leaderboard</Link>
      </Shell>
    );
  if (username && resolved.name === username && resolved.status === "error")
    return (
      <Shell title="Profile unavailable." subtitle={`The profile could not be loaded. ${resolved.error}`}>
        <button className="luna-btn" onClick={() => setAttempt(attempt + 1)}>Retry</button>{" "}
        <Link className="luna-btn pm-back" to="/leaderboard">Back to leaderboard</Link>
      </Shell>
    );
  if (resolving || (isPublic && remote.user !== publicUser))
    return <Shell title="Loading profile…" subtitle={username}><div className="pm-empty">Loading on-chain account…</div></Shell>;
  if (isPublic && remote.error)
    return (
      <Shell title="Profile unavailable." subtitle={`The account could not be loaded. ${remote.error}`}>
        <button className="luna-btn" onClick={() => setAttempt(attempt + 1)}>Retry</button>{" "}
        <Link className="luna-btn pm-back" to="/leaderboard">Back to leaderboard</Link>
      </Shell>
    );

  // One shape for both views, built from real data only.
  let view;
  if (isPublic) {
    const { account: a, positions, history } = remote;
    const summary = tradeSummary(history);
    const openPnl = positions.reduce((s, p) => s + Number(p.pnl ?? 0), 0);
    const openMargin = positions.reduce((s, p) => s + Number(p.margin), 0);
    const realized = Number(a.stats.realizedPnl);
    const rewards = Number(a.staking.claimed) + Number(a.staking.credited);
    const closed = a.stats.trades - a.stats.open;
    view = {
      name: resolved.username || shortAddress(publicUser), summary, realized, openPnl, rewards,
      result: realized + openPnl + rewards,
      badges: badgesFor({ trades: a.stats.trades, staked: Number(a.staking.staked), liquidations: a.stats.liquidations }),
      balances: [
        ["Staked HOUSE", compact(Number(a.staking.staked))],
        ["Rewards claimed", rewardUsd(Number(a.staking.claimed))],
        ["Rewards credited", rewardUsd(Number(a.staking.credited))],
      ],
      stats: [
        ["Equity", "$" + money(Number(a.balance) + openMargin + openPnl)],
        ["Available to trade", "$" + money(Number(a.balance))],
        ["Open PnL (est.)", "$" + money(openPnl), openPnl >= 0 ? "up" : "down"],
        ["Open notional", "$" + compact(positions.reduce((s, p) => s + Number(p.margin) * p.leverage, 0))],
        ["Margin in use", "$" + money(openMargin)],
        ["Historical PnL + rewards", "$" + money(realized + rewards), realized + rewards >= 0 ? "up" : "down"],
        ["Historical PnL", "$" + money(realized), realized >= 0 ? "up" : "down"],
        ["Volume", "$" + compact(Number(a.stats.volume))],
        ["Closed trades", String(closed)],
        ["Win rate", closed ? ((a.stats.wins / closed) * 100).toFixed(0) + "%" : "–"],
        ["Liquidations", String(a.stats.liquidations)],
        ["Average leverage", summary.avgLeverage == null ? "–" : money(summary.avgLeverage, 0) + "×"],
        ["HOUSE earned", compact(Number(a.stats.minted))],
      ],
    };
  } else {
    const summary = tradeSummary(account.history);
    const rewards = account.claimed + (account.credited ?? 0) + account.claimable;
    const trades = account.history.filter((p) => p.type === "close" || p.type === "liquidation");
    view = {
      name: ownUsername || (me ? shortAddress(me) : "Portfolio"), summary, realized: summary.realized, openPnl: account.unrealizedPnL, rewards,
      result: summary.realized + account.unrealizedPnL + rewards,
      badges: badgesFor({ trades: summary.trades + account.positions.length, staked: account.staked, liquidations: summary.liquidations }),
      balances: [
        ["Wallet balance", compact(account.token)],
        ["Staked HOUSE", compact(account.staked)],
        ["Rewards claimed", rewardUsd(account.claimed + (account.credited ?? 0))],
        ["Claimable USDG", rewardUsd(account.claimable)],
      ],
      stats: [
        ["Equity", "$" + money(account.totalEquity)],
        ["Available to trade", "$" + money(account.availableMargin)],
        ["Open PnL", "$" + money(account.unrealizedPnL), account.unrealizedPnL >= 0 ? "up" : "down"],
        ["Open notional", "$" + compact(account.positions.reduce((s, p) => s + p.notional, 0))],
        ["Margin in use", "$" + money(account.usedMargin)],
        ["Historical PnL + rewards", "$" + money(summary.realized + rewards), summary.realized + rewards >= 0 ? "up" : "down"],
        ["Historical PnL", "$" + money(summary.realized), summary.realized >= 0 ? "up" : "down"],
        ["Volume", "$" + compact([...account.positions, ...trades].reduce((s, p) => s + p.notional, 0))],
        ["Closed trades", String(summary.trades)],
        ["Win rate", summary.trades ? ((summary.wins / summary.trades) * 100).toFixed(0) + "%" : "–"],
        ["Liquidations", String(summary.liquidations)],
        ["Average leverage", summary.avgLeverage == null ? "–" : money(summary.avgLeverage, 0) + "×"],
        ["HOUSE earned", compact(account.minted)],
      ],
    };
  }
  const { name, result } = view;
  const chartKey = chartMetric === "equity" ? "equity" : "realizedPnl";
  const pnlFresh = pnl.key === pnlKey;
  const series = pnlFresh && pnl.data ? pnlChartSeries(pnl.data, chartKey) : [];
  const chartEmpty = !chartUser
    ? "Connect your wallet to see your performance."
    : !pnlFresh
      ? "Loading performance…"
      : pnl.error
        ? `Performance could not be loaded. ${pnl.error}`
        : "No trades or transfers in this period yet.";

  const profileActions = (
    <div className="pm-row-actions">
      {!isPublic && (
        <button className="luna-btn" onClick={() => setModal({ type: "username", onSaved: (saved) => setOwnUsername(saved.username) })}>
          {ownUsername ? "Edit username" : "Set your username"}
        </button>
      )}
      <button
        className="luna-btn luna-btn-active"
        onClick={() =>
          setModal({
            type: "share",
            data: { title: name, value: `${result >= 0 ? "+" : "−"}$${money(Math.abs(result))}`, tone: result >= 0 ? "up" : "down", detail: "NET PNL + USDG REWARDS" },
          })
        }
      >
        {isPublic ? "Share profile ↗" : "Share portfolio ↗"}
      </button>
    </div>
  );
  return (
    <Shell
      dashboard={isPublic ? "public-profile" : "portfolio"}
      title={isPublic ? name : "Portfolio"}
      kicker={`资产 / ${isPublic ? "PUBLIC PROFILE" : "PORTFOLIO"}`}
      subtitle={isPublic ? `${shortAddress(publicUser)} · On-chain account on Robinhood Chain` : "Your balances, positions and share of the house."}
    >
      <div className="jt-page jt-page-wide jt-dash">
      <PageHead
        title={isPublic ? name : ownUsername ? `@${ownUsername}` : "Portfolio"}
        aside={profileActions}
      >
        {isPublic ? `${shortAddress(publicUser)} · onchain account on Robinhood Chain` : me ? "Your balances, positions and performance." : "Connect your wallet to see your balances, positions and performance."}
      </PageHead>
      <div className="jt-row">
        <Panel
          title="Performance"
          className="ds-plot-panel"
          aside={
            <div className="pm-panel-actions">
              <FilterSelect label="Portfolio chart metric" value={chartMetric} onChange={setChartMetric} items={[["equity", "Equity"], ["trading", "Realized PnL"]]} />
              <ChartTools label="Portfolio chart range" range={range} onRange={setRange} paused={paused} onPause={setPaused} ranges={[["1d", "1D"], ["7d", "7D"], ["30d", "30D"], ["all", "ALL"]]} />
            </div>
          }
        >
          <SnapshotChart
            paused={paused}
            series={[{ name: chartMetric === "equity" ? "Equity" : "Realized PnL", data: series, fill: true }]}
            height={250}
            empty={chartEmpty}
            label={`${isPublic ? name : "Your"} ${chartMetric === "equity" ? "equity (net deposits + realized PnL)" : "realized PnL"} over time`}
          />
        </Panel>
        <div className="jt-stack">
          <div className="pm-profile-hero">
            <div>
              <span className="pm-eyebrow">Net PnL + rewards</span>
              <strong className={result >= 0 ? "pm-up" : "pm-down"}>
                {result >= 0 ? "+" : "−"}${money(Math.abs(result))}
              </strong>
              <dl className="pm-data-rows">
                <div><dt>Trading PnL</dt><dd className={view.realized + view.openPnl >= 0 ? "pm-up" : "pm-down"}>${money(view.realized + view.openPnl)}</dd></div>
                <div><dt>USDG rewards</dt><dd>{rewardUsd(view.rewards)}</dd></div>
              </dl>
            </div>
            <div className="jt-hero-foot">
              <details className="pm-badge-details">
                <summary>Badges ({view.badges.length})</summary>
                <div className="pm-badges">
                  {view.badges.length ? view.badges.map((badge) => <span key={badge}>{badge}</span>) : <span>No badges yet</span>}
                </div>
              </details>
              {!isPublic && ownUsername && (
                <Link className="ds-inline-link" to="/u/$username" params={{ username: ownUsername }}>
                  Public profile ↗
                </Link>
              )}
            </div>
          </div>
          <Panel title="HOUSE balances" aside={!isPublic && <Link className="ds-inline-link" to="/token">Staking ↗</Link>}>
            <StatRows rows={view.balances} />
          </Panel>
        </div>
      </div>
      <Panel title="Account stats" className="jt-stats-panel">
        <StatRows rows={[...view.stats, ["Leaderboard badges", String(view.badges.length)]]} />
      </Panel>
      {isPublic ? (
        <Panel title="Best trades">
          <div className="pm-table-scroll">
            <table className="pm-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Direction</th>
                  <th>Leverage</th>
                  <th>Margin</th>
                  <th>Entry → exit</th>
                  <th>PnL</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {view.summary.best.map((t) => {
                  const p = Number(t.pnl);
                  return (
                    <tr key={t.id}>
                      <td>{t.market}</td>
                      <td>{t.side === "long" ? "Long" : "Short"}</td>
                      <td>{t.leverage}×</td>
                      <td>${money(Number(t.margin))}</td>
                      <td>{money(Number(t.entryPrice))} → {money(Number(t.exitPrice))}</td>
                      <td className={p >= 0 ? "pm-up" : "pm-down"}>{p >= 0 ? "+" : "−"}${money(Math.abs(p))}</td>
                      <td>{t.type === "liquidation" ? "Liquidated" : "Closed"} · {new Date(t.at * 1000).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!view.summary.best.length && <div className="pm-empty">No closed trades yet.</div>}
        </Panel>
      ) : <PortfolioDetails />}
      </div>
    </Shell>
  );
}
