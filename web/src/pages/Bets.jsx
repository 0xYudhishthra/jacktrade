import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getBets, getPrices } from "../lib/api.js";
import { short } from "../lib/chain.js";
import { TxHash, fmtPrice, fmtUsd, timeAgo } from "../components/Common.jsx";
import { CONNECTOR_URL } from "../lib/config.js";

export function marketSymbol(market) {
  return String(market ?? "")
    .toUpperCase()
    .replace(/[-_ ]?\/?USDG?$/, "")
    .replace(/\/.*$/, "")
    .trim();
}

export function isLong(side) {
  return /^(long|buy|true)$/i.test(String(side));
}

function livePnl(bet, prices) {
  const px = prices?.[marketSymbol(bet.market)];
  const entry = Number(bet.entryPrice);
  const notional = Number(bet.marginUsd) * Number(bet.leverage);
  if (!px || !(entry > 0) || !(notional > 0)) return null;
  const pnl = notional * (px / entry - 1) * (isLong(bet.side) ? 1 : -1);
  return Math.max(pnl, -Number(bet.marginUsd)); // can't lose more than the margin
}

function BetCard({ bet, prices }) {
  const long = isLong(bet.side);
  const closed = bet.closedAt || /closed|liquidated|cashed/i.test(bet.status || "");
  const pnl = closed
    ? bet.pnlUsd !== undefined && bet.pnlUsd !== null
      ? Number(bet.pnlUsd)
      : null
    : livePnl(bet, prices);
  return (
    <article className="bet">
      <div className="bet-top">
        <span className="badge badge-grok">via Grok</span>
        <span className={`badge ${long ? "badge-long" : "badge-short"}`}>{long ? "LONG" : "SHORT"}</span>
        <span className="bet-market">{marketSymbol(bet.market) || bet.market}</span>
        <span className="muted small bet-time">{timeAgo(bet.openedAt)}</span>
      </div>
      <div className="bet-grid">
        <div>
          <span className="stat-label">Margin</span>
          <span>{fmtUsd(bet.marginUsd)}</span>
        </div>
        <div>
          <span className="stat-label">Leverage</span>
          <span>{bet.leverage}×</span>
        </div>
        <div>
          <span className="stat-label">Entry</span>
          <span>{bet.entryPrice ? fmtPrice(bet.entryPrice) : "–"}</span>
        </div>
        <div>
          <span className="stat-label">{closed ? "PnL" : pnl !== null ? "Live PnL" : "Status"}</span>
          {pnl !== null ? (
            <span className={pnl >= 0 ? "pos" : "neg"}>
              {pnl >= 0 ? "+" : ""}
              {fmtUsd(pnl)}
            </span>
          ) : (
            <span>{bet.status || (closed ? "closed" : "open")}</span>
          )}
        </div>
      </div>
      <div className="bet-foot">
        <span className="small muted">
          {short(bet.wallet)}
          {bet.positionId !== undefined && bet.positionId !== null ? ` · #${bet.positionId}` : ""}
        </span>
        {bet.txHash && (
          <span className="small">
            <TxHash hash={bet.txHash} />
          </span>
        )}
        <Link className="btn btn-sm btn-accent" to={`/real/${encodeURIComponent(bet.id)}`}>
          Make it real
        </Link>
      </div>
    </article>
  );
}

export default function BetsPage() {
  const [bets, setBets] = useState(null);
  const [error, setError] = useState("");
  const [prices, setPrices] = useState({});
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      getPrices()
        .then((list) => {
          if (!alive) return;
          const map = {};
          for (const p of list) if (Number(p.usd) > 0) map[marketSymbol(p.name)] = Number(p.usd);
          setPrices(map);
        })
        .catch(() => {});
      try {
        const list = await getBets(50);
        if (!alive) return;
        list.sort((a, b) => (Date.parse(b.openedAt) || b.openedAt || 0) - (Date.parse(a.openedAt) || a.openedAt || 0));
        setBets(list);
        setError("");
      } catch (err) {
        if (!alive) return;
        setError(err.message);
        setBets((prev) => prev ?? []);
      }
      if (alive) timer.current = setTimeout(tick, 5000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="page">
      <section className="hero hero-sm">
        <h1>Grok bets</h1>
        <p className="lead">
          Live bets placed by Grok on JackTrade. Like a call? Hit <b>Make it real</b> to buy the real token
          with a Definitive Flash order.
        </p>
      </section>

      {error && (
        <div className="alert alert-warn small">
          Feed unavailable ({error}). Retrying every 5s. Connector: <span className="mono">{CONNECTOR_URL}</span>
        </div>
      )}

      {bets === null ? (
        <p className="muted">Loading bets…</p>
      ) : bets.length === 0 ? (
        <div className="card empty">
          <h3>No Grok bets yet</h3>
          <p className="muted">
            Once someone tells Grok to place a bet, it shows up here within seconds.{" "}
            <Link to="/">Connect Grok</Link> to place the first one.
          </p>
        </div>
      ) : (
        <div className="bets">
          {bets.map((b) => (
            <BetCard key={b.id} bet={b} prices={prices} />
          ))}
        </div>
      )}
    </div>
  );
}
