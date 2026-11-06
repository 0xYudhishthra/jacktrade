import { Star } from "lucide-react";
import { useTradingSession } from "@/hooks/useTradingSession";
import MarketIcon from "@/components/product/MarketIcon";

function fmtPrice(p) {
  if (!Number.isFinite(p)) return "—";
  if (p >= 1000)
    return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

export default function MarketWatch({
  markets,
  selected,
  onSelect,
  search = "",
  livePrices,
  favorites = [],
  onFavorite,
}) {
  // 24h change from the price service (hourly candles, or the previous close for equity previews).
  const { marketStatus, quotes, dayStats = {} } = useTradingSession();
  const q = search.trim().toLowerCase();
  const rows = markets
    .filter((m) => !q || (m.symbol + " " + m.name).toLowerCase().includes(q))
    .map((m) => ({ ...m, change24h: dayStats[m.symbol]?.change24h ?? null, price: livePrices[m.symbol] }));

  return (
    <aside className="hm-panel flex flex-col flex-1 min-h-0">
      <div
        className="px-3 py-2.5 flex items-center justify-between shrink-0"
        style={{ borderBottom: "1px solid #EAF4FF" }}
      >
        <h2
          className="text-[12px] font-bold flex items-center gap-1.5"
          style={{ color: "var(--terminal-text)" }}
        >
          <span
            className="w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold"
            style={{ background: "#2F7DE1", color: "#F8FBFF" }}
          >
            ▤
          </span>
          Market Watch
        </h2>
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{ background: "#EAF4FF", color: "var(--terminal-secondary)" }}
        >
          24h
        </span>
      </div>
      <div className="flex-1 overflow-auto hm-scroll p-1.5 flex flex-col gap-0.5">
        {rows.map((m) => {
          const active = m.symbol === selected;
          const up = m.change24h >= 0;
          return (
            <div key={m.symbol} className="hm-market-option">
              <button
                onClick={() => onSelect(m.symbol)}
                aria-label={`Select ${m.symbol}`}
                className={`hm-market-row ${active ? "is-selected" : ""} flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors`}
                style={{
                  background: active ? "#D9E9FF" : "transparent",
                  border: active ? "1px solid #9FC4EF" : "1px solid transparent",
                }}
              >
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{ background: m.color + "25", color: m.color }}
                >
                  <MarketIcon market={m} size={16} />
                </span>
                <div className="flex flex-col min-w-0 flex-1 leading-tight">
                  <span
                    className="text-[10.5px] font-semibold truncate"
                    style={{ color: "var(--terminal-text)" }}
                  >
                    {m.symbol}
                  </span>
                  <span
                    className="text-[8.5px] truncate"
                    style={{ color: "var(--terminal-muted)" }}
                  >
                    {m.name}
                    {/* Live when the price service sends a price; a preview without its Pyth feed yet is coming soon. */}
                    {!quotes?.[m.symbol] ? " · coming soon" : marketStatus[m.symbol] === "closed" ? " · market closed" : " · live"}
                  </span>
                </div>
                <div className="flex flex-col items-end leading-tight shrink-0">
                  <span
                    className="text-[10.5px] font-mono font-semibold tabular-nums"
                    style={{ color: "var(--terminal-text)" }}
                  >
                    {fmtPrice(m.price)}
                  </span>
                  {m.change24h != null && (
                    <span
                      className="text-[9px] font-mono tabular-nums"
                      style={{ color: up ? "var(--terminal-up)" : "var(--terminal-down)" }}
                    >
                      {up ? "+" : ""}
                      {m.change24h.toFixed(2)}%
                    </span>
                  )}
                </div>
              </button>
              {onFavorite && (
                <button
                  type="button"
                  className="hm-market-favorite"
                  aria-label={`Favorite ${m.symbol}`}
                  aria-pressed={favorites.includes(m.symbol)}
                  onClick={() => onFavorite(m.symbol)}
                >
                  <Star size={11} fill={favorites.includes(m.symbol) ? "currentColor" : "none"} />
                </button>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <div
            className="py-6 text-center text-[11px] font-mono"
            style={{ color: "var(--terminal-muted)" }}
          >
            no matches
          </div>
        )}
      </div>
    </aside>
  );
}
