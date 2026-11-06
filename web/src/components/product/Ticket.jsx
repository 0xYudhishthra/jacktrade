import { useEffect, useState } from "react";
import { useTradingSession } from "@/hooks/useTradingSession";
import { useProductUI, Hint } from "./ProductUI";
import { money, liquidationPrice, bpsPercent, LEVERAGE } from "@/lib/protocolModel";
import { orderMinimumIssue, orderMinimums } from "@/lib/orderMinimums";
import CollateralIcon from "./CollateralIcon";
import { previewPriceLabel } from "@/lib/pricesApi";
// The 10× floor and 10× steps are product choices; the ceiling is the market's maxLeverage from the backend.
const clampLeverage = (value, maximum) =>
  Math.max(LEVERAGE.min, Math.min(maximum ?? Infinity, Math.round(value / LEVERAGE.step) * LEVERAGE.step));
const LEVERAGE_TIERS = [
  [10, "warming up"],
  [25, "getting spicy"],
  [50, "spicy"],
  [100, "degen"],
  [250, "certified degen"],
  [500, "the house loves you"],
  [750, "no thoughts, only leverage"],
  [1000, "max degen"],
];
export default function Ticket({ onDraft }) {
  const { account, symbol, livePrice, markets, walletConnected, marketStatus, quotes, protocolMarket, fees } = useTradingSession();
  const { setModal, notify } = useProductUI();
  const [side, setSide] = useState("long");
  const [margin, setMargin] = useState("");
  const [lev, setLev] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("hm.product-desk.leverage"));
      return Number.isFinite(saved) && saved > 0 ? clampLeverage(saved) : LEVERAGE.default;
    } catch {
      return LEVERAGE.default;
    }
  });
  const [error, setError] = useState("");
  // One order at a time: a second click while the first is on its way would be rejected (no free balance left).
  const [opening, setOpening] = useState(false);
  const amount = Number(margin) || 0;
  const market = markets.find((m) => m.symbol === symbol);
  // Preview: an equity (SPY, TSLA) the Exchange hasn't listed yet. Priced by Pyth (or not yet), never tradable.
  const closed = !!market?.closed;
  const marketClosed = marketStatus[symbol] === "closed";
  const needsConnection = !walletConnected || account.availableMargin <= 0 || account.sessionUntil <= Date.now();
  const paused = account.pauseUntil > Date.now();
  // Limits from GET /api/config and /api/markets; unknown (null) until the market is listed.
  const maxLeverage = protocolMarket?.maxLeverage
    ? Math.max(LEVERAGE.min, Math.floor(protocolMarket.maxLeverage / LEVERAGE.step) * LEVERAGE.step)
    : null;
  const sliderMax = maxLeverage ?? LEVERAGE.min;
  // The saved choice stays as the user's preference; what is shown and sent never exceeds the market's maximum.
  const leverageValue = clampLeverage(lev, sliderMax);
  const liquidation = liquidationPrice(side, livePrice, leverageValue, protocolMarket?.liqBufferBps);
  const minimumIssue = margin !== "" ? orderMinimumIssue(amount, leverageValue, protocolMarket) : null;
  const minimumLeverage = minimumIssue?.kind === "position" && amount > 0
    ? Math.ceil(minimumIssue.minimum / amount / LEVERAGE.step) * LEVERAGE.step
    : 0;
  // Margin × leverage must reach the minimum position: when the margin alone can't, leverage rises to the lowest step
  // that gets there (the user can still go higher), and the notice says why.
  const [autoLeverage, setAutoLeverage] = useState(null);
  const positionFloor = orderMinimums(protocolMarket).positionSize;
  useEffect(() => {
    if (!(amount >= orderMinimums(protocolMarket).margin) || !maxLeverage) return;
    const needed = Math.ceil(positionFloor / amount / LEVERAGE.step) * LEVERAGE.step;
    if (needed > leverageValue && needed <= maxLeverage) {
      leverage(needed);
      setAutoLeverage({ margin: amount, leverage: needed });
    }
    // Only when the margin changes: a leverage the user picks afterwards is theirs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, maxLeverage, positionFloor]);
  const autoNotice = autoLeverage && autoLeverage.margin === amount && autoLeverage.leverage === leverageValue
    ? `Minimum position is $${money(positionFloor, 0)}, so leverage was set to ${money(autoLeverage.leverage, 0)}× for ${money(amount)} USDG margin.`
    : "";
  const minimumNotice = autoNotice && !minimumIssue ? autoNotice : minimumIssue?.kind === "margin"
    ? `Minimum margin: ${money(minimumIssue.minimum)} USDG.`
    : minimumIssue?.kind === "position"
      ? `Minimum position: $${money(minimumIssue.minimum, 0)}. ${maxLeverage && minimumLeverage <= maxLeverage ? `With ${money(amount)} USDG margin, use at least ${money(minimumLeverage, 0)}×.` : "Increase your margin."}`
      : minimumIssue?.kind === "maxPosition"
        ? `Maximum position: $${money(minimumIssue.maximum, 0)}. Lower your margin or leverage.`
        : "";
  const leverageTier = LEVERAGE_TIERS.findLast(([min]) => leverageValue >= min)[1];
  const winFee = bpsPercent(fees?.winFeeBps);
  const priceDigits = livePrice < 1 ? 4 : 2;
  // Price-feed rules from the backend: never open on a stale, missing or low-confidence price.
  const feedBlock = {
    stale: "Price is stale (no update for over 5 s). Opening is paused until it recovers.",
    wide: "Pyth confidence is too wide right now. The contracts would reject this open.",
    offline: "Price service is unreachable. Reconnecting…",
    unlisted: "This market is not listed by the protocol yet.",
    closed: `${symbol.replace("-PERP", "")} trades during US market hours. Opening resumes when the market opens.`,
  }[marketStatus[symbol]] ?? (!closed && !Number.isFinite(livePrice) ? "Waiting for the first price…" : undefined);
  useEffect(() => {
    onDraft({
      side,
      margin: amount,
      leverage: leverageValue,
      entry: livePrice,
      liq: liquidation,
      tp: null,
      sl: null,
    });
  }, [side, amount, leverageValue, livePrice, liquidation, onDraft]);
  function leverage(n) {
    const next = clampLeverage(n, maxLeverage);
    setLev(next);
    try {
      localStorage.setItem("hm.product-desk.leverage", String(next));
    } catch {
      /* Preference is optional. */
    }
  }
  async function submit(e) {
    e.preventDefault();
    setError("");
    if (closed) return;
    if (!walletConnected) {
      setModal({ type: "wallet" });
      return;
    }
    if (account.availableMargin <= 0) {
      setModal({ type: "deposit-trade" });
      return;
    }
    if (minimumIssue) return;
    if (feedBlock) return;
    if (opening) return;
    setOpening(true);
    // No trading session on this browser yet: authorize it (one gas-free signature) and open in the same click.
    if (account.sessionUntil <= Date.now()) {
      try {
        await account.enableSession();
      } catch (reason) {
        setOpening(false);
        setError(reason?.code === 4001 || /reject|denied|cancel/i.test(reason?.message ?? "") ? "Signature cancelled in your wallet." : reason.message);
        return;
      }
    }
    const result = await account.openPosition({
      symbol,
      side,
      margin: amount,
      leverage: leverageValue,
      entry: livePrice,
      tp: null,
      sl: null,
    });
    setOpening(false);
    if (!result.ok) setError(result.error);
    else {
      setMargin("");
      notify(`${symbol} ${side} opened · ${leverageValue}× · $${money(amount * leverageValue, 0)}`);
    }
  }
  return (
    <form
      className="hm-panel hm-focus-ticket pm-ticket pm-original-ticket"
      onSubmit={submit}
      noValidate
      aria-label="Market order"
    >
      <div className="hm-focus-ticket-body">
        <div className="hm-focus-direction" aria-label="Position direction">
          <button
            type="button"
            className="sky-direction-long"
            aria-pressed={side === "long"}
            onClick={() => setSide("long")}
          >
            ↗ Long
          </button>
          <button
            type="button"
            className="sky-direction-short"
            aria-pressed={side === "short"}
            onClick={() => setSide("short")}
          >
            ↘ Short
          </button>
        </div>
        <div className="hm-focus-amount">
          <div className="hm-focus-amount-top">
            <label htmlFor="product-margin">Margin</label>
            <div className="hm-focus-quick">
              {[
                [0.25, "25%"],
                [0.5, "Half"],
                [1, "Max"],
              ].map(([n, label]) => (
                <button
                  type="button"
                  key={label}
                  onClick={() => {
                    setMargin(String(Math.floor(account.availableMargin * n * 100) / 100));
                    setError("");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="hm-focus-amount-input">
            <span className="hm-focus-currency">
              <CollateralIcon size={18} /> USDG
            </span>
            <input
              id="product-margin"
              aria-label="Margin in USDG"
              type="number"
              inputMode="decimal"
              min={orderMinimums(protocolMarket).margin}
              step="0.01"
              value={margin}
              onChange={(e) => {
                setMargin(e.target.value);
                setError("");
              }}
              placeholder="0.00"
              aria-invalid={!!error || !!minimumIssue}
              aria-describedby={[
                minimumNotice && "product-order-minimum",
                error && "product-order-error",
              ].filter(Boolean).join(" ") || undefined}
            />
          </div>
          <p className="hm-focus-available">{money(account.availableMargin)} USDG available</p>

        </div>
        <div
          className={`hm-focus-leverage hm-lev${leverageValue >= 500 ? " is-hot" : ""}`}
          style={{ "--heat": ((Math.log10(leverageValue) - 1) / 2).toFixed(3) }}
        >
          <span className="hm-focus-field-label">Leverage</span>
          <div className="hm-focus-leverage-value">
            <button
              type="button"
              className="luna-btn"
              aria-label="Decrease leverage"
              disabled={leverageValue <= LEVERAGE.min}
              onClick={() => leverage(leverageValue - LEVERAGE.step)}
            >
              −
            </button>
            <output aria-live="polite">
              <b key={leverageValue} className="hm-lev-number">
                {money(leverageValue, 0)}
              </b>
              <span>×</span>
            </output>
            <button
              type="button"
              className="luna-btn"
              aria-label="Increase leverage"
              disabled={leverageValue >= sliderMax}
              onClick={() => leverage(leverageValue + LEVERAGE.step)}
            >
              +
            </button>
          </div>
          <input
            id="product-leverage"
            aria-label="Leverage"
            type="range"
            min={LEVERAGE.min}
            max={sliderMax}
            step={LEVERAGE.step}
            value={leverageValue}
            disabled={!maxLeverage}
            onChange={(e) => leverage(Number(e.target.value))}
            className="hm-range"
            style={{ "--fill": ((leverageValue - LEVERAGE.min) / Math.max(1, sliderMax - LEVERAGE.min)) * 100 + "%" }}
          />
          <p key={leverageTier} className="hm-lev-tier" aria-hidden="true">
            {leverageTier}
          </p>
          <div className="hm-focus-leverage-stops">
            {[10, 50, 100, 500, 1000].filter((n) => n <= (maxLeverage ?? 0)).map((n) => (
              <button type="button" key={n} aria-pressed={leverageValue === n} onClick={() => leverage(n)}>
                {money(n, 0)}×
              </button>
            ))}
          </div>
        </div>
        {closed && (
          <p className="pm-callout" role="status">
            Preview · {previewPriceLabel(quotes?.[symbol])}.{marketClosed ? " Market closed." : ""} {symbol.replace("-PERP", "")} is not tradable yet.
          </p>
        )}
        {feedBlock && !closed && (
          <p className="pm-callout pm-feed-callout" role="status">
            {feedBlock}
          </p>
        )}
        {minimumNotice && (
          <p id="product-order-minimum" className="pm-minimum-callout" role="status">
            {minimumNotice}
          </p>
        )}
        {error && (
          <p id="product-order-error" className="hm-focus-order-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className={`hm-focus-submit ${side === "long" ? "sky-buy" : "sky-sell"}`}
          disabled={opening || closed || (!needsConnection && (paused || !!feedBlock || amount <= 0 || !!minimumIssue))}
          aria-busy={opening}
        >
          {opening
            ? ({ executed: "Opened ✓", submitted: "Confirming on-chain…", queued: "Sending…" }[account.protocol?.status] ?? "Opening position…")
            : closed
            ? "Preview only"
            : !walletConnected
            ? "Connect wallet"
            : account.availableMargin <= 0
              ? "Deposit to Trade"
            : account.sessionUntil <= Date.now()
              ? `Enable trading & open ${side}`
            : paused
              ? "Trading paused"
              : side === "long"
                ? "Open long"
                : "Open short"}
        </button>
      </div>
      <dl className="hm-focus-order-summary">
        <div>
          <dt>Position size</dt>
          <dd>${money(amount * leverageValue)}</dd>
        </div>
        <div>
          <dt>Est. entry</dt>
          <dd>{Number.isFinite(livePrice) ? `$${money(livePrice, priceDigits)}` : "—"}</dd>
        </div>
        <div>
          <dt>
            Est. liquidation{" "}
            <span title="From the current price, your leverage and the market's liquidation buffer">≈</span>
          </dt>
          <dd className="hm-focus-liquidation">
            {liquidation != null && !closed ? `$${money(liquidation, priceDigits)}` : "—"}
          </dd>
        </div>
        <div>
          <dt>
            Win fee{" "}
            <Hint
              text={`No entry, spread or funding fee. Only realized profit pays the ${winFee ?? "protocol"} win fee. Settlement applies a dead zone and a price impact that grows with position size, set per market by the protocol.`}
            />
          </dt>
          <dd>{winFee ? `${winFee} + impact` : "—"}</dd>
        </div>

      </dl>
    </form>
  );
}
