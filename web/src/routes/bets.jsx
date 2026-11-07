// Agent bets: live feed of bets placed by Grok (or any MCP client) through the JackTrade connector.
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Shell } from "@/components/product/ProductUI";
import { GrokBadge, Note, PageHead, TxHash, fmtPrice, fmtUsd, short, timeAgo } from "@/components/grok/GrokUI";
import { getBets, getTriggers } from "@/lib/grok/api";
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
    <article className="jt-panel jt-bet">
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
        <Link className="jt-btn-ghost" to="/real/$id" params={{ id: String(bet.id) }}>
          Make it real
        </Link>
      </div>
    </article>
  );
}

const TRIGGER_STATE = {
  armed: { label: "watching", cls: "pm-up" },
  firing: { label: "firing…", cls: "pm-up" },
  fired: { label: "fired ✓", cls: "pm-up" },
  expired: { label: "expired", cls: "jt-muted" },
  cancelled: { label: "cancelled", cls: "jt-muted" },
  failed: { label: "failed", cls: "pm-down" },
};

function TriggerRow({ t, prices }) {
  const sym = marketSymbol(t.market) || t.market;
  const px = prices[`${sym}-PERP`];
  const state = TRIGGER_STATE[t.status] || { label: t.status, cls: "jt-muted" };
  const long = isLong(t.side);
  return (
    <div className="jt-trigger">
      <GrokBadge />
      <span className="jt-trigger-rule">
        <b>{sym}</b> {t.condition} {fmtPrice(t.price)} → <span className={long ? "pm-up" : "pm-down"}>{long ? "long" : "short"}</span>{" "}
        {fmtUsd(t.marginUsd)} at {t.leverage}×
      </span>
      <span className="jt-muted jt-small">{px ? `now ${fmtPrice(px)}` : ""}</span>
      <span className={`jt-trigger-state ${state.cls}`} title={t.error || ""}>{state.label}</span>
    </div>
  );
}

export default function BetsPage() {
  const { prices } = useLivePrices();
  const [bets, setBets] = useState(null);
  const [triggers, setTriggers] = useState([]);
  const [error, setError] = useState("");
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [list, trig] = await Promise.all([getBets(50), getTriggers(30).catch(() => [])]);
        if (!alive) return;
        const at = (b) => Date.parse(b.openedAt) || Number(b.openedAt) || 0;
        setBets([...list].sort((a, b) => at(b) - at(a)));
        setTriggers(trig);
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
    <Shell>
      <div className="jt-page">
        <PageHead title="Agent bets">Live trades placed by Grok and other AI agents. Updates every few seconds.</PageHead>
        {error && <Note>Feed unavailable ({error}). Retrying every 5 s.</Note>}
        {triggers.length > 0 && (
          <section className="jt-panel jt-triggers">
            <h3>Armed by Grok</h3>
            <p className="jt-muted jt-small">
              Conditional bets Grok set up. JackTrade watches the price every few seconds and places the bet the moment a level
              crosses, within your limits.
            </p>
            {triggers.slice(0, 12).map((t) => (
              <TriggerRow key={t.id} t={t} prices={prices} />
            ))}
          </section>
        )}
        {bets === null ? (
          <div className="jt-card-plain jt-empty">Loading…</div>
        ) : bets.length === 0 ? (
          <div className="jt-card-plain jt-empty">
            <img src="/brand/jack-256.webp" alt="" />
            <strong>No agent trades yet</strong>
            <span>When someone tells Grok to trade, it shows up here within seconds.</span>
            <Link to="/grok" className="jt-btn">Connect Grok</Link>
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
