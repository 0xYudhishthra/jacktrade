// Hackathon addition (ETHGlobal Mumbai 2026): the public feed of bets Grok placed through the JackTrade connector,
// with live PnL and a "Make it real" button that copies the call into the real token with Definitive Flash.
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Shell, Panel } from "@/components/product/ProductUI";
import { getBets, getPrices } from "@/lib/grok/api";
import { CONNECTOR_URL } from "@/lib/grok/config";
import { GrokBadge, KV, Note, TxHash, fmtPrice, fmtUsd, short, timeAgo } from "@/components/grok/GrokUI";

export function marketSymbol(market) {
  return String(market ?? "")
    .toUpperCase()
    .replace(/[-_ ]?\/?USDG?$/, "")
    .replace(/\/.*$/, "")
    .replace(/-PERP$/, "")
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
    <section className="hm-panel pm-panel jt-bet">
      <div className="pm-panel-body jt-bet">
        <div className="jt-bet-top">
          <GrokBadge className="jt-badge-lead" />
          <span className={`jt-side ${long ? "pm-up" : "pm-down"}`}>{long ? "LONG" : "SHORT"}</span>
          <span className="jt-bet-market">{marketSymbol(bet.market) || bet.market}</span>
          <span className="jt-small jt-muted jt-bet-time">{timeAgo(bet.openedAt)}</span>
        </div>
        <KV
          rows={[
            ["Margin", fmtUsd(bet.marginUsd)],
            ["Leverage", `${bet.leverage}×`],
            ["Entry", bet.entryPrice ? fmtPrice(bet.entryPrice) : "–"],
            pnl !== null
              ? [closed ? "PnL" : "Live PnL", `${pnl >= 0 ? "+" : ""}${fmtUsd(pnl)}`, pnl >= 0 ? "pm-up" : "pm-down"]
              : ["Status", bet.status || (closed ? "closed" : "open")],
          ]}
        />
        <div className="jt-bet-foot">
          <span className="jt-small jt-muted">
            {short(bet.wallet)}
            {bet.positionId !== undefined && bet.positionId !== null ? ` · #${bet.positionId}` : ""}
          </span>
          {bet.txHash && (
            <span className="jt-small">
              <TxHash hash={bet.txHash} />
            </span>
          )}
          <Link className="luna-btn luna-btn-active jt-cta" to="/real/$id" params={{ id: String(bet.id) }}>
            Make it real
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function GrokBetsPage() {
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
          for (const p of list) if (Number(p.usd) > 0) map[marketSymbol(p.name ?? p.market)] = Number(p.usd);
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
    <Shell
      title="Grok bets"
      kicker="JACKTRADE / GROK"
      subtitle="Live bets placed by Grok on JackTrade. Like a call? Hit Make it real to buy the real token with a Definitive Flash order."
      action={
        <Link to="/grok" className="luna-btn">
          Connect Grok ↗
        </Link>
      }
    >
      <div className="jt-grok">
        {error && (
          <Note>
            Feed unavailable ({error}). Retrying every 5s. Connector: <span className="jt-mono">{CONNECTOR_URL}</span>
          </Note>
        )}
        {bets === null ? (
          <div className="pm-empty">Loading bets…</div>
        ) : bets.length === 0 ? (
          <Panel title="No Grok bets yet">
            <p className="jt-muted">
              Once someone tells Grok to place a bet, it shows up here within seconds.{" "}
              <Link to="/grok">Connect Grok</Link> to place the first one.
            </p>
          </Panel>
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
