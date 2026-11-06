import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Settings2 } from "lucide-react";

// Tick is the live view; the rest are the candle intervals the backend serves.
const TIMEFRAMES = ["tick", "1m", "5m", "15m", "1h", "4h", "1d"];
const timeframeLabel = (tf) => (tf === "tick" ? "Tick" : tf);

export default function ChartControls({
  timeframe,
  onTimeframe,
  chartType,
  onChartType,
  volume,
  onVolume,
  rsi,
  onRsi,
  details,
  onDetails,
  children,
}) {
  const [open, setOpen] = useState(null);
  const root = useRef(null);
  const timeframeButton = useRef(null);
  const toolsButton = useRef(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event) => {
      if (event.type === "keydown") {
        if (event.key !== "Escape") return;
        setOpen(null);
        (open === "timeframes" ? timeframeButton : toolsButton).current?.focus();
      } else if (!root.current?.contains(event.target)) setOpen(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open]);
  return (
    <div className="pm-chart-controls" ref={root}>
      {onTimeframe && (
      <div className="pm-chart-control">
        <button
          ref={timeframeButton}
          type="button"
          className="luna-btn pm-chart-control-toggle"
          aria-label={`Timeframe: ${timeframeLabel(timeframe)}`}
          aria-expanded={open === "timeframes"}
          aria-controls="trade-timeframes"
          onClick={() => setOpen(open === "timeframes" ? null : "timeframes")}
        >
          {timeframeLabel(timeframe)} <ChevronDown size={11} />
        </button>
        {open === "timeframes" && (
          <div
            id="trade-timeframes"
            className="pm-chart-menu pm-timeframe-menu"
            role="region"
            aria-label="Timeframes"
          >
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                className={`luna-btn ${tf === timeframe ? "luna-btn-active" : ""}`}
                aria-pressed={tf === timeframe}
                onClick={() => {
                  onTimeframe(tf);
                  setOpen(null);
                  timeframeButton.current?.focus();
                }}
              >
                {timeframeLabel(tf)}
              </button>
            ))}
          </div>
        )}
      </div>
      )}
      <div className="pm-chart-control">
        <button
          ref={toolsButton}
          type="button"
          className="luna-btn pm-chart-control-toggle"
          aria-expanded={open === "tools"}
          aria-controls="trade-chart-tools"
          onClick={() => setOpen(open === "tools" ? null : "tools")}
        >
          <Settings2 size={11} /> Tools <ChevronDown size={11} />
        </button>
        {open === "tools" && (
          <div
            id="trade-chart-tools"
            className="pm-chart-menu pm-tools-menu"
            role="region"
            aria-label="Chart tools"
          >
            {onChartType && (
            <fieldset>
              <legend>Chart</legend>
              <div className="pm-chart-type-options" role="group" aria-label="Chart type">
                {[
                  ["candles", "Candles"],
                  ["line", "Line"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={chartType === value}
                    className={`luna-btn ${chartType === value ? "luna-btn-active" : ""}`}
                    onClick={() => onChartType(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <ToolOption
                label="Price details"
                description="Open, high, low and close of the candle under the cursor"
                checked={details}
                onChange={onDetails}
              />
              {onVolume && (
                <ToolOption
                  label="Volume"
                  description="JackTrade volume per candle: USDG notional opened"
                  checked={volume}
                  onChange={onVolume}
                />
              )}
              <ToolOption
                label="RSI (14)"
                description="Momentum from 0 to 100; above 70 is stretched, below 30 is washed out"
                checked={rsi}
                onChange={onRsi}
              />
            </fieldset>
            )}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

export function ToolOption({ label, description, checked, onChange }) {
  const id = useId();
  return (
    <label className="pm-chart-tool-option">
      <input
        type="checkbox"
        checked={checked}
        aria-describedby={description ? id : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <b>{label}</b>
        {description && <small id={id}>{description}</small>}
      </span>
    </label>
  );
}
