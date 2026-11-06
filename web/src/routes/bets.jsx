// Agent bets: live feed of bets placed by Grok (or any MCP client) through the JackTrade connector.
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Shell } from "@/components/product/ProductUI";
import { GrokBadge, Note, TxHash, fmtPrice, fmtUsd, short, timeAgo } from "@/components/grok/GrokUI";
import { getBets } from "@/lib/grok/api";
import { useLivePrices } from "@/hooks/useLivePrices";
import { isLong, marketSymbol } from "@/lib/grok/bets";

function livePnl(bet, prices) {
  const px = prices[`${marketSymbol(bet.market)}-PERP`];
  const entry = Number(bet.entryPrice);
  const margin = Number(bet.marginUsd);
  const notional = margin * Number(bet.leverage);
  if (!(px > 0) || !(entry > 0) || !(notional > 0)) return null;
  const pnl = notional * (px / entry - 1) * (isLong(bet.side) ? 1 : -1);
  return Math.max(pnl, -margin); // a bet can't lose more than its margin
}

function BetCard({ bet, prices }) {
  const long = isLong(bet.side);
  const closed = bet.closedAt || /closed|liquidated|cashed/i.test(bet.status || "");
  const pnl = closed ? (bet.pnlUsd != null ? Number(bet.pnlUsd) : null) : livePnl(bet, prices);
  return (
    <article className="hm-panel jt-bet">
      <div className="jt-bet-top">
        <GrokBadge />
        <span className={`jt-side ${long ? "pm-up" : "pm-down"}`}>{long ? "LONG" : "SHORT"}</span>
        <span className="jt-bet-market">{marketSymbol(bet.market) || bet.market}</span>
        <span className="jt-bet-time jt-muted jt-small">{timeAgo(bet.openedAt)}</span>
      </div>
      <dl className="jt-kv">
        <div><dt>Margin</dt><dd>{fmtUsd(bet.marginUsd)}</dd></div>
        <div><dt>Leverage</dt><dd>{bet.leverage}×</dd></div>
        <div><dt>Entry</dt><dd>{bet.entryPrice ? fmtPrice(bet.entryPrice) : "–"}</dd></div>
        <div>
          <dt>{closed ? "PnL" : pnl !== null ? "Live PnL" : "Status"}</dt>
          {pnl !== null ? (
            <dd className={pnl >= 0 ? "pm-up" : "pm-down"}>{pnl >= 0 ? "+" : ""}{fmtUsd(pnl)}</dd>
          ) : (
            <dd>{bet.status || (closed ? "closed" : "open")}</dd>
          )}
        </div>
      </dl>
      <div className="jt-bet-foot jt-small jt-muted">
        <span>
          {short(bet.wallet)}
          {bet.positionId != null ? ` · #${bet.positionId}` : ""}
        </span>
        {bet.txHash && <TxHash hash={bet.txHash} />}
        <Link className="luna-btn" to="/real/$id" params={{ id: String(bet.id) }}>
          Make it real
        </Link>
      </div>
    </article>
  );
}

export default function BetsPage() {
  const { prices } = useLivePrices();
  const [bets, setBets] = useState(null);
  const [error, setError] = useState("");
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const list = await getBets(50);
        if (!alive) return;
        const at = (b) => Date.parse(b.openedAt) || Number(b.openedAt) || 0;
        setBets([...list].sort((a, b) => at(b) - at(a)));
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
    <Shell
      title="Agent bets"
      kicker="JACKTRADE / AGENTS"
      subtitle="Live bets placed by Grok and other AI agents through the JackTrade connector. Updates every 5 seconds."
    >
      <div className="jt-grok">
        {error && <Note>Feed unavailable ({error}). Retrying every 5 s.</Note>}
        {bets === null ? (
          <div className="pm-empty">Loading bets…</div>
        ) : bets.length === 0 ? (
          <div className="pm-empty">
            No agent bets yet. Once someone tells Grok to place a bet, it shows up here within seconds.{" "}
            <Link to="/grok">Connect Grok</Link> to place the first one.
          </div>
        ) : (
          <div className="jt-bets">
            {bets.map((b) => (
              <BetCard key={b.id} bet={b} prices={prices} />
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
