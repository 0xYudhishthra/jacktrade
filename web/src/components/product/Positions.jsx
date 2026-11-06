import { useState } from "react";
import { useTradingSession } from "@/hooks/useTradingSession";
import { useProductUI, FilterSelect } from "./ProductUI";
import { money, compact } from "@/lib/protocolModel";
import { GrokBadge } from "@/components/grok/GrokUI";
import { positionIdOf, useGrokPositionIds } from "@/lib/grok/useGrokBets";

// Open rows show the indexer's own figures (GET /api/positions): mark price, net PnL after dead zone, impact and fee,
// and the liquidation price. They refresh with every account poll.
const markOf = (p) => (Number.isFinite(p.mark) ? p.mark : null);
export default function Positions({ historyOnly = false, hideTabs = false, control, embedded = false }) {
  const { account } = useTradingSession();
  const grokIds = useGrokPositionIds();
  const { setModal } = useProductUI();
  const [tab, setTab] = useState(historyOnly ? "history" : "open");
  const [filter, setFilter] = useState("all");
  const [page,setPage]=useState(0);
  const closing = null; // closing runs in the close sheet now
  const [closeError,setCloseError]=useState("");
  function closePosition(id) {
    setCloseError("");
    setModal({ type: "close", id });
  }
  const rows =
    tab === "open"
      ? account.positions
      : account.history.filter(
          (p) =>
            (p.reason === "close" || p.reason === "liquidation") &&
            (filter === "all" ||
            (filter === "liquidations" ? p.liquidated : filter === "wins" ? p.pnl > 0 : p.pnl < 0)),
        );
  const pages=Math.max(1,Math.ceil(rows.length/25));
  const currentPage=Math.min(page,pages-1);
  const visibleRows=embedded?rows.slice(currentPage*25,currentPage*25+25):rows;
  return (
    <section className="hm-panel pm-positions">
      {(!embedded || tab === "history") && <div className="pm-position-toolbar">
        {hideTabs ? (
          control || <span>{tab === "open" ? "Open positions" : "Trade history"}</span>
        ) : (
          <FilterSelect
            items={
              historyOnly
                ? [["history", "History"]]
                : [
                    ["open", `Positions (${account.positions.length})`],
                    ["history", "History"],
                  ]
            }
            label="Detailed positions view"
            value={tab}
            onChange={setTab}
          />
        )}
        {tab === "history" ? (
          <FilterSelect
            label="Filter trade history"
            value={filter}
            onChange={value=>{setFilter(value);setPage(0);}}
            items={[["all", "All trades"], ["wins", "Wins"], ["losses", "Losses"], ["liquidations", "Liquidations"]]}
          />
        ) : (
          <span>
            Open PnL{" "}
            <b className={account.unrealizedPnL >= 0 ? "pm-up" : "pm-down"}>
              ${money(account.unrealizedPnL)}
            </b>
          </span>
        )}
      </div>}
      <div className="pm-table-scroll">
        <table className="pm-table">
          <thead>
            <tr>
              {[
                "Market",
                "Side",
                ...(embedded ? ["Size", "Entry", "Liquidation"] : []),
                "Margin",
                "Leverage",
                tab === "open" ? "Mark" : "Exit",
                "PnL",
                "HOUSE earned",
                "Status / duration",
                "Actions",
              ].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((p) => {
              const current = markOf(p);
              const value = tab === "open" ? (current == null ? null : p.pnl) : p.pnl;
              const liquidatable = tab === "open" && (p.liquidatable ?? (current != null && (p.side === "long" ? current <= p.liq : current >= p.liq)));
              return (
                <tr key={p.id}>
                  <td>
                    <strong>{p.symbol}</strong>
                    {grokIds.has(positionIdOf(p)) && <GrokBadge />}
                  </td>
                  <td className={p.side === "long" ? "pm-up" : "pm-down"}>
                    {p.side.toUpperCase()}
                  </td>
                  {embedded && <><td>${money(p.notional)}</td><td>${money(p.entry)}</td><td>{p.liq ? `$${money(p.liq)}` : "—"}</td></>}
                  <td>${money(p.margin)}</td>
                  <td>{p.leverage}×</td>
                  <td>{tab === "open" ? (current == null ? "—" : `$${money(current)}`) : `$${money(p.exit)}`}</td>
                  <td className={value == null ? undefined : value >= 0 ? "pm-up" : "pm-down"} title={tab === "open" ? "Net if closed now: after dead zone, price impact and win fee" : undefined}>
                    {value == null ? "—" : `${value >= 0 ? "+" : "−"}$${money(Math.abs(value))}`}
                  </td>
                  <td>{p.minted ? compact(p.minted) : "—"}</td>
                  <td>
                    {tab === "open"
                      ? liquidatable ? <span className="pm-down">Liquidating</span> : "Open"
                      : `${p.reason} · ${Math.max(1, Math.round(p.duration / 1000))}s`}
                  </td>
                  <td>
                    <div className="pm-row-actions">
                      {tab === "open" && (
                        <button className="luna-btn" disabled={closing===p.id || liquidatable} title={liquidatable ? "Past liquidation: the liquidator closes it" : undefined} onClick={() => closePosition(p.id)}>
                          {closing===p.id?"Closing…":"Close"}
                        </button>
                      )}
                      <button
                        className="luna-btn"
                        onClick={() =>
                          setModal({
                            type: "share",
                            data: {
                              title: `${p.symbol} / ${p.side.toUpperCase()} / ${p.leverage}×`,
                              value: value == null ? "—" : `${value >= 0 ? "+" : "−"}$${money(Math.abs(value))}`,
                              tone: (value ?? 0) >= 0 ? "up" : "down",
                              detail: p.minted
                                ? `${compact(p.minted)} HOUSE minted from this loss`
                                : tab === "open" ? "Open position · net PnL if closed now" : `Closed · ${p.reason}`,
                            },
                          })
                        }
                      >
                        Share
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="pm-empty">
            {tab === "open"
              ? "No open positions"
              : "No trades"}
          </div>
        )}
      </div>
      {closeError&&<p className="pm-error" role="alert">{closeError}</p>}
      {embedded&&<div className="ds-pagination"><span>{rows.length} {tab === "open" ? "positions" : "trades"}</span><button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>← Previous</button><span>{currentPage+1} / {pages}</span><button disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>Next →</button></div>}
    </section>
  );
}
