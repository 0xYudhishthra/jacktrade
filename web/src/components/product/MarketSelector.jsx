import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, Star, X } from "lucide-react";
import { useTradingSession } from "@/hooks/useTradingSession";
import MarketWatch from "@/components/trading/MarketWatch";
import MarketIcon from "./MarketIcon";
import { previewPriceLabel } from "@/lib/pricesApi";
export default function MarketSelector() {
  const {
    markets,
    symbol,
    setSymbol,
    stats,
    livePrice,
    livePrices,
    favorites,
    toggleFavorite,
    marketStatus,
    ticks,
    quotes,
  } = useTradingSession();
  const series = ticks[symbol] ?? [];
  const move = (series.at(-1)?.price ?? 0) - (series.at(-2)?.price ?? 0);
  // The 24h change shows once the price service has answered; never a placeholder figure.
  const showChange = stats.change24h != null;
  const status = marketStatus[symbol];
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const root = useRef(null);
  const toggle = useRef(null);
  const market = markets.find((m) => m.symbol === symbol);
  useEffect(() => {
    if (!open) return;
    const dismiss = (e) => {
      if (e.type === "keydown") {
        if (e.key === "Escape") {
          setOpen(false);
          toggle.current?.focus();
        }
      } else if (!root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open]);
  return (
    <div className="hm-focus-market-strip pm-floating-market" ref={root}>
      <button
        ref={toggle}
        type="button"
        className="luna-btn pm-floating-market-toggle"
        aria-label={`Change market, ${symbol}`}
        aria-expanded={open}
        aria-controls="product-market-list"
        onClick={() => setOpen(!open)}
      >
        <span
          className="pm-floating-market-coin"
          style={{ color: market.color, background: market.color + "22" }}
        >
          <MarketIcon market={market} size={18} />
        </span>
        <span className="pm-floating-market-symbol">{symbol}</span>
        <strong
          key={livePrice}
          className={move > 0 ? "hm-flash-up" : move < 0 ? "hm-flash-down" : ""}
        >
          {Number.isFinite(livePrice)
            ? livePrice.toLocaleString("en-US", {
                minimumFractionDigits: livePrice < 1 ? 4 : 2,
                maximumFractionDigits: livePrice < 1 ? 4 : 2,
              })
            : "—"}
        </strong>
        {market.closed && (
          <span title={`Preview market: ${previewPriceLabel(quotes?.[symbol])}; not tradable`}>
            {status === "closed" ? "Market closed" : `Preview · ${previewPriceLabel(quotes?.[symbol])}`}
          </span>
        )}
        {showChange && (
          <span className={stats.change24h >= 0 ? "pm-up" : "pm-down"}>
            {stats.change24h >= 0 ? "+" : ""}
            {stats.change24h.toFixed(2)}%
          </span>
        )}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          id="product-market-list"
          className="hm-focus-market-popover"
          role="region"
          aria-label="Choose a market"
        >
          <div className="hm-focus-picker-top">
            <label>
              <Search size={14} />
              <input
                autoFocus
                aria-label="Search markets"
                placeholder="Search markets..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button
              aria-label="Close market selector"
              onClick={() => {
                setOpen(false);
                toggle.current?.focus();
              }}
            >
              <X size={15} />
            </button>
          </div>
          <button
            className="pm-market-favorites"
            aria-pressed={onlyFavorites}
            onClick={() => setOnlyFavorites(!onlyFavorites)}
          >
            <Star size={10} fill={onlyFavorites ? "currentColor" : "none"} /> Favorites{" "}
            {onlyFavorites ? "only" : "/ all markets"}
          </button>
          <MarketWatch
            markets={(onlyFavorites
              ? markets.filter((m) => favorites.includes(m.symbol))
              : markets
            ).toSorted((a, b) => Number(!!a.closed) - Number(!!b.closed))}
            selected={symbol}
            livePrices={livePrices}
            search={search}
            favorites={favorites}
            onFavorite={toggleFavorite}
            onSelect={(next) => {
              setSymbol(next);
              setOpen(false);
              setSearch("");
              toggle.current?.focus();
            }}
          />
        </div>
      )}
    </div>
  );
}
