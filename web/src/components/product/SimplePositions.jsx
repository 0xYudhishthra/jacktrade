import { useId, useMemo, useState } from "react";
import { TradeLeaderboard, TradeStatus } from "./TradeViews";
import TradeHistoryTab from "@/components/trading/TradeHistoryTab";
import { GrokBadge } from "@/components/grok/GrokUI";
import { positionIdOf, useGrokPositionIds } from "@/lib/grok/useGrokBets";

const VIEWS = ["Positions", "History", "Leaderboard", "Status"];

export default function SimplePositions({
  positions,
  onClose,
  history: activity,
  unrealizedPnL,
  tape,
  detailedPositions,
}) {
  const [tab, setTab] = useState("Positions");
  // The account history also lists deposits and withdrawals; this tab shows closed trades only.
  const history = useMemo(
    () => activity
      .filter((item) => item.reason === "close" || item.reason === "liquidation")
      .map((item) => ({ ...item, size: item.entry ? item.notional / item.entry : 0 })),
    [activity],
  );
  const id = useId();
  const pnlUp = unrealizedPnL >= 0;
  const selectWithKeyboard = (event) => {
    const index = VIEWS.indexOf(tab);
    const next = event.key === "ArrowRight" ? (index + 1) % VIEWS.length
      : event.key === "ArrowLeft" ? (index + VIEWS.length - 1) % VIEWS.length
      : event.key === "Home" ? 0 : event.key === "End" ? VIEWS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(VIEWS[next]);
    event.currentTarget.querySelectorAll('[role="tab"]')[next].focus();
  };
  return (
    <div className="hm-panel hm-positions-panel">
      <div
        className="px-4 py-2.5 flex items-center justify-between flex-wrap gap-2"
        style={{ borderBottom: "1px solid #EAF4FF" }}
      >
        <div className="pd-trade-tabs" role="tablist" aria-label="Trade views" onKeyDown={selectWithKeyboard}>
          {VIEWS.map((view) => (
            <button key={view} role="tab" id={`${id}-${view}`} aria-controls={`${id}-content`}
              aria-selected={tab === view} tabIndex={tab === view ? 0 : -1}
              onClick={() => setTab(view)}>
              {view}{view === "Positions" && positions.length > 0 ? ` (${positions.length})`
                : view === "History" && history.length > 0 ? ` (${history.length})` : ""}
            </button>
          ))}
        </div>
        {tape}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium" style={{ color: "var(--terminal-secondary)" }}>
            Unrealized PnL
          </span>
          <span
            className="text-[12px] font-mono font-bold tabular-nums"
            style={{ color: pnlUp ? "var(--terminal-up)" : "var(--terminal-down)" }}
          >
            {pnlUp ? "+" : "-"}${fmt(Math.abs(unrealizedPnL))}
          </span>
        </div>
      </div>
      <div className="overflow-auto hm-scroll" style={{ maxHeight: 250 }}
        role="tabpanel" id={`${id}-content`} aria-labelledby={`${id}-${tab}`} tabIndex={0}>
        {tab === "Positions" && (detailedPositions || (
          <PositionsTable positions={positions} onClose={onClose} />
        ))}
        {tab === "History" && (history.length === 0 ? (
          <div className="h-28 flex items-center justify-center">
            <p className="text-[12px] font-mono" style={{ color: "var(--terminal-muted)" }}>
              No trade history yet.
            </p>
          </div>
        ) : (
          <TradeHistoryTab history={history} />
        ))}
        {tab === "Leaderboard" && <TradeLeaderboard />}
        {tab === "Status" && <TradeStatus />}
      </div>
    </div>
  );
}

function fmtPrice(p) {
  if (p >= 1000)
    return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}
function fmt(n, d = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Mark, net PnL and liquidation come from the indexer (GET /api/positions), refreshed with every account poll.
function PositionsTable({ positions, onClose }) {
  const grokIds = useGrokPositionIds();
  if (positions.length === 0) {
    return (
      <div className="h-28 flex items-center justify-center">
        <p className="text-[12px] font-mono" style={{ color: "var(--terminal-muted)" }}>
          No open positions
        </p>
      </div>
    );
  }
  return (
    <table className="w-full text-[11.5px]">
      <thead>
        <tr style={{ background: "#EAF4FF", color: "var(--terminal-secondary)" }}>
          {[
            "Market",
            "Side",
            "Size",
            "Entry Price",
            "Mark Price",
            "PnL",
            "ROE",
            "Liq. Price",
            "Leverage",
            "",
          ].map((h) => (
            <th
              key={h}
              className="px-3 py-2 text-left font-mono font-semibold text-[9.5px] uppercase tracking-wider"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => {
          const mark = Number.isFinite(p.mark) ? p.mark : null;
          const pnl = mark == null ? null : p.pnl;
          const roe = pnl == null ? null : (pnl / p.margin) * 100;
          const up = (pnl ?? 0) >= 0;
          const liquidatable = p.liquidatable ?? (mark != null && (p.side === "long" ? mark <= p.liq : mark >= p.liq));
          return (
            <tr key={p.id} style={{ borderBottom: "1px solid #EAF4FF" }}>
              <td className="px-3 py-2 font-semibold" style={{ color: "var(--terminal-text)" }}>
                {p.symbol}
                {grokIds.has(positionIdOf(p)) && <GrokBadge />}
              </td>
              <td className="px-3 py-2">
                <span
                  className="text-[10px] font-mono font-bold tracking-wide"
                  style={{
                    color: p.side === "long" ? "var(--terminal-up)" : "var(--terminal-down)",
                  }}
                >
                  {p.side.toUpperCase()}
                </span>
              </td>
              <td
                className="px-3 py-2 font-mono tabular-nums"
                style={{ color: "var(--terminal-text)" }}
              >
                ${fmt(p.notional)}
              </td>
              <td
                className="px-3 py-2 font-mono tabular-nums"
                style={{ color: "var(--terminal-secondary)" }}
              >
                {fmtPrice(p.entry)}
              </td>
              <td
                className="px-3 py-2 font-mono tabular-nums"
                style={{ color: "var(--terminal-secondary)" }}
              >
                {mark == null ? "—" : fmtPrice(mark)}
              </td>
              <td
                className="px-3 py-2 font-mono tabular-nums font-semibold"
                style={{ color: up ? "var(--terminal-up)" : "var(--terminal-down)" }}
              >
                {pnl == null ? "—" : `${up ? "+" : "-"}$${fmt(Math.abs(pnl))}`}
              </td>
              <td
                className="px-3 py-2 font-mono tabular-nums font-semibold"
                style={{ color: up ? "var(--terminal-up)" : "var(--terminal-down)" }}
              >
                {roe == null ? "—" : `${up ? "+" : ""}${roe.toFixed(1)}%`}
              </td>
              <td
                className="px-3 py-2 font-mono tabular-nums"
                style={{ color: "var(--terminal-secondary)" }}
              >
                {fmtPrice(p.liq)}
              </td>
              <td
                className="px-3 py-2 font-mono tabular-nums"
                style={{ color: "var(--terminal-secondary)" }}
              >
                {p.leverage}x
              </td>
              <td className="px-3 py-2">
                <button
                  onClick={() => onClose(p.id)}
                  disabled={liquidatable}
                  title={liquidatable ? "Past liquidation: the liquidator closes it" : undefined}
                  className="luna-btn px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold transition-colors hover:bg-[#D9E9FF]"
                  style={{
                    background: "#EAF4FF",
                    border: "1px solid #9FC4EF",
                    color: "var(--terminal-accent)",
                  }}
                >
                  {liquidatable ? "Liquidating" : "Close"}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
