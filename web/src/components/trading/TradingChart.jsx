import { useTheme } from "@/components/dream/ThemeProvider";
import { chartColor } from "@/lib/chartTheme";
import { useCallback, useEffect, useRef, useState } from "react";
import ChartControls from "@/components/product/ChartControls";
import { usePersistentState } from "@/hooks/usePersistentState";

// HTML Canvas 2D price chart with line/candlestick views, volume, RSI and crosshair.
// Candles follow papertrade: solid, slightly rounded bodies in clear green/red, hairline wicks in
// the same ink and room to breathe after the last bar. Hovering a candle quiets the rest.
// No glitch inside the chart — financial data stays clean.
const EMPTY_LINES = [];
// Clear on the light panel without going neon.
const INK_UP = "#12a172";
const INK_DOWN = "#e5485f";
const HEADROOM = 0.06; // empty bars after the latest candle
const slotsFor = (count, width) => count + Math.ceil(count * Math.max(HEADROOM, 110 / Math.max(1, width - 110)));

function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgG = gains / period,
    avgL = losses / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

function fmtAxis(p) {
  if (p >= 1000)
    return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}
function fmtVolM(v) {
  return (v * 80).toFixed(3) + "M";
}

export default function TradingChart({
  symbol,
  candles,
  timeframe,
  onTimeframe,
  header,
  headerEnd,
  overlayExtras,
  riskLines = EMPTY_LINES,
  heatmap = false,
  tools,
  noVolume = false,
  message,
}) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const overlayRef = useRef(null);
  const [hover, setHover] = useState(null); // {x, y, candle}
  const [view, setView] = useState({ offset: 0, bars: 120 }); // visible window
  // Every non-tick view is a candle chart; line stays available under Tools.
  const [chartType, setChartType] = usePersistentState("hm.chart.type", "line");
  const dragRef = useRef(null);
  const [volume, setVolume] = usePersistentState("hm.chart.volume", false);
  const [rsi, setRsi] = usePersistentState("hm.chart.rsi", false);
  const [details, setDetails] = usePersistentState("hm.chart.details", false);
  const [announcement, setAnnouncement] = useState("");
  // Backend candles have no volume, so the volume pane stays off for those markets.
  const volumeOn = volume && !noVolume;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.fillStyle = chartColor("rgba(37, 74, 135, 0.035)", theme);
    ctx.font = `${Math.round(Math.min(W / 7, 96))}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("jacktrade", (W - 64) / 2, H / 2);
    ctx.restore();

    const padL = 10,
      padR = 12,
      padT = details ? (overlayRef.current?.offsetHeight || 48) + 42 : 92,
      padB = 24;
    const volH = volumeOn ? 32 : 0,
      rsiH = rsi ? 52 : 0;
    const chartH = Math.max(60, H - padT - padB - volH - rsiH - (volumeOn ? 8 : 0) - (rsi ? 8 : 0));
    const chartW = W - padL - padR;

    const visible = candles.slice(
      Math.max(0, candles.length - view.bars - view.offset),
      candles.length - view.offset || undefined,
    );
    if (visible.length === 0) return;
    const baseIdx = Math.max(0, candles.length - view.bars - view.offset);

    const priceHighs = visible.map((c) => (chartType === "candles" ? c.h : c.c));
    const priceLows = visible.map((c) => (chartType === "candles" ? c.l : c.c));
    let maxP = Math.max(...priceHighs);
    let minP = Math.min(...priceLows);
    const pad = (maxP - minP) * 0.08 || 1;
    maxP += pad;
    minP -= pad;
    const maxVol = Math.max(...visible.map((c) => c.v)) || 1;

    const closes = candles.map((c) => c.c);
    const rsiAll = rsiSeries(closes);
    const lastRsi = rsiAll[baseIdx + visible.length - 1];

    const barW = chartW / slotsFor(visible.length, chartW);
    const cw = Math.max(1, barW * 0.72);

    const xAt = (i) => padL + i * barW + barW / 2;
    const yPrice = (p) => padT + (1 - (p - minP) / (maxP - minP)) * chartH;

    if (details) {
      // legend row (hovered candle or the latest one)
      const hc = hover && hover.candle ? hover.candle : visible[visible.length - 1];
      const chg = hc.c - hc.o;
      const chgPct = (chg / hc.o) * 100;
      const chgColor = hc.c >= hc.o ? INK_UP : INK_DOWN;
      ctx.font = "11px Geist Mono, monospace";
      let lx = padL;
      const parts = [
        ["O ", "#858b98"],
        [fmtAxis(hc.o), "#171923"],
        ["  H ", "#858b98"],
        [fmtAxis(hc.h), "#171923"],
        ["  L ", "#858b98"],
        [fmtAxis(hc.l), "#171923"],
        ["  C ", "#858b98"],
        [fmtAxis(hc.c), chgColor],
        [
          `  ${chg >= 0 ? "+" : ""}${chg.toFixed(2)} (${chg >= 0 ? "+" : ""}${chgPct.toFixed(2)}%)`,
          chgColor,
        ],
        ...(noVolume ? [] : [[`  V ${fmtVolM(hc.v)}`, "#858b98"]]),
      ];
      for (const [txt, color] of parts) {
        ctx.fillStyle = color;
        ctx.fillText(txt, lx, padT - 13);
        lx += ctx.measureText(txt).width;
      }
    }

    // dotted grid
    ctx.strokeStyle = chartColor("rgba(157, 145, 174, 0.14)", theme);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.font = "11px Geist Mono, monospace";
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = padT + (i / gridLines) * chartH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + chartW, y);
      ctx.stroke();
      const p = maxP - (i / gridLines) * (maxP - minP);
      ctx.fillStyle = chartColor("#858b98", theme);
      ctx.save();
      ctx.textAlign = "right";
      if (Math.abs(y - yPrice(visible.at(-1).c)) > 21) ctx.fillText(fmtAxis(p), W - 10, y + 3);
      ctx.restore();
    }
    ctx.setLineDash([]);

    if (chartType === "line") {
      // The line uses closing prices; its fill never obscures the grid.
      ctx.beginPath();
      visible.forEach((c, i) => {
        const x = xAt(i);
        const y = yPrice(c.c);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(xAt(visible.length - 1), padT + chartH);
      ctx.lineTo(xAt(0), padT + chartH);
      ctx.closePath();
      ctx.fillStyle = chartColor("rgba(36, 41, 54, 0.035)", theme);
      ctx.fill();

      ctx.beginPath();
      visible.forEach((c, i) => {
        const x = xAt(i);
        const y = yPrice(c.c);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = chartColor("#242936", theme);
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();

      const lastPoint = visible[visible.length - 1];
      ctx.beginPath();
      ctx.arc(xAt(visible.length - 1), yPrice(lastPoint.c), 3, 0, Math.PI * 2);
      ctx.fillStyle = chartColor("#254a87", theme);
      ctx.fill();
    } else {
      const width = Math.max(1, Math.round(cw) | 1); // odd, so the wick sits dead center
      const radius = width >= 4 ? Math.min(2, width / 3) : 0;
      const focused = hover?.candle?.t;
      visible.forEach((c, i) => {
        const x = Math.round(xAt(i)) + 0.5;
        const rising = c.c >= c.o;
        const yOpen = yPrice(c.o);
        const yClose = yPrice(c.c);
        const top = Math.round(Math.min(yOpen, yClose));
        const bodyH = Math.max(1, Math.round(Math.abs(yClose - yOpen)));
        const ink = rising ? INK_UP : INK_DOWN;
        ctx.globalAlpha = focused !== undefined && focused !== c.t ? 0.35 : 1;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, Math.round(yPrice(c.h)));
        ctx.lineTo(x, Math.round(yPrice(c.l)));
        ctx.stroke();
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.roundRect(Math.round(x - width / 2), top, width, bodyH, bodyH > 2 * radius ? radius : 0);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    if (heatmap) {
      const mid = visible[visible.length - 1].c;
      for (let i = -5; i <= 5; i++) {
        const level = mid * (1 + i * 0.004);
        if (level < minP || level > maxP) continue;
        ctx.fillStyle = i < 0 ? "rgba(255, 71, 102,0.06)" : "rgba(31, 224, 127,0.06)";
        ctx.fillRect(padL, yPrice(level) - 3, chartW, 6 + Math.abs(i % 3));
      }
    }
    // Order preview and personal entries share the same price coordinates. Labels are nudged
    // apart so close prices (entry vs liquidation at high leverage) stay readable.
    const placed = riskLines
      .filter((line) => Number.isFinite(line.price) && line.price >= minP && line.price <= maxP)
      .map((line) => ({ line, y: yPrice(line.price) }))
      .sort((a, b) => a.y - b.y);
    let lastLabelY = -Infinity;
    for (const item of placed) {
      item.labelY = Math.max(item.y, lastLabelY + 18);
      lastLabelY = item.labelY;
    }
    for (const { line, y, labelY } of placed) {
      ctx.save();
      if (heatmap && line.label === "LIQ") {
        ctx.fillStyle = chartColor("#c85c6714", theme);
        ctx.fillRect(padL, y - 7, chartW, 14);
      }
      ctx.strokeStyle = line.color;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + chartW, y);
      ctx.stroke();
      ctx.font = "11px Geist Mono, monospace";
      const text = `${line.label} ${fmtAxis(line.price)}`;
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = chartColor("#fffffff2", theme);
      ctx.fillRect(padL + 4, labelY - 15, w, 17);
      ctx.strokeStyle = line.color;
      ctx.strokeRect(padL + 4.5, labelY - 14.5, w - 1, 16);
      ctx.fillStyle = line.color;
      ctx.fillText(text, padL + 10, labelY - 3);
      ctx.restore();
    }

    // Volume remains below the price chart.
    const volTop = padT + chartH + (volumeOn ? 8 : 0);
    if (volumeOn)
      visible.forEach((c, i) => {
        const x = xAt(i);
        const up = c.c >= c.o;
        const vh = (c.v / maxVol) * volH;
        ctx.fillStyle = up ? "rgba(31, 224, 127,0.25)" : "rgba(255, 71, 102,0.25)";
        ctx.fillRect(x - cw / 2, volTop + volH - vh, cw, vh);
      });

    // RSI subpanel
    const rsiTop = volTop + volH + (rsi ? 8 : 0);
    if (rsi) {
      ctx.strokeStyle = chartColor("rgba(132, 118, 157, 0.22)", theme);
      ctx.beginPath();
      ctx.moveTo(padL, rsiTop - 4);
      ctx.lineTo(padL + chartW, rsiTop - 4);
      ctx.stroke();
      ctx.setLineDash([2, 3]);
      [0.7, 0.3].forEach((lv) => {
        const y = rsiTop + (1 - lv) * rsiH;
        ctx.strokeStyle = chartColor("rgba(132, 118, 157, 0.22)", theme);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + chartW, y);
        ctx.stroke();
        ctx.fillStyle = chartColor("#858b98", theme);
        ctx.save();
        ctx.textAlign = "right";
        ctx.fillText(String(lv * 10), W - 10, y + 3);
        ctx.restore();
      });
      ctx.setLineDash([]);
      ctx.strokeStyle = chartColor("#242936", theme);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < visible.length; i++) {
        const val = rsiAll[baseIdx + i];
        if (val == null) continue;
        const x = xAt(i);
        const y = rsiTop + (1 - val / 100) * rsiH;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (lastRsi != null) {
        ctx.fillStyle = chartColor("#171923", theme);
        ctx.font = "11px Geist Mono, monospace";
        ctx.fillText(`RSI(14) ${lastRsi.toFixed(2)}`, padL + 4, rsiTop + 10);
      }
    }

    // current price line
    const lastC = visible[visible.length - 1];
    if (lastC) {
      const y = yPrice(lastC.c);
      ctx.strokeStyle = chartColor("rgba(170, 141, 213, 0.7)", theme);
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + chartW, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "bold 11px Geist Mono, monospace";
      const priceTagWidth = Math.ceil(ctx.measureText(fmtAxis(lastC.c)).width) + 14;
      ctx.fillStyle = chartColor("#254a87", theme);
      ctx.fillRect(W - 10 - priceTagWidth, y - 10, priceTagWidth, 20);
      ctx.fillStyle = chartColor("#ffffff", theme);
      ctx.save();
      ctx.textAlign = "right";
      ctx.fillText(fmtAxis(lastC.c), W - 17, y + 4);
      ctx.restore();
    }

    // time axis labels
    ctx.font = "11px Geist Mono, monospace";
    ctx.fillStyle = chartColor("#858b98", theme);
    ctx.textAlign = "center";
    const labelCount = Math.max(2, Math.min(8, Math.floor(chartW / 125)));
    const step = Math.ceil(visible.length / labelCount);
    for (let i = 0; i < visible.length; i += step) {
      const d = new Date(visible[i].t);
      ctx.fillText(
        d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
        Math.max(28, Math.min(padL + chartW - 26, xAt(i))),
        H - 6,
      );
    }
    ctx.textAlign = "left";

    // crosshair
    if (hover && hover.x >= padL && hover.x <= padL + chartW) {
      const hy = hover.y ?? yPrice(hover.candle.c);
      ctx.strokeStyle = chartColor("rgba(197, 186, 214, 0.5)", theme);
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(hover.x, padT);
      ctx.lineTo(hover.x, rsiTop + rsiH);
      ctx.moveTo(padL, hy);
      ctx.lineTo(padL + chartW, hy);
      ctx.stroke();
      ctx.setLineDash([]);
      if (hy >= padT && hy <= padT + chartH) {
        const hoverPrice = maxP - ((hy - padT) / chartH) * (maxP - minP);
        ctx.font = "11px Geist Mono, monospace";
        const hoverTagWidth = Math.ceil(ctx.measureText(fmtAxis(hoverPrice)).width) + 14;
        const tagX = W - 10 - hoverTagWidth;
        ctx.fillStyle = chartColor("#ffffff", theme);
        ctx.strokeStyle = chartColor("#242936", theme);
        ctx.fillRect(tagX, hy - 10, hoverTagWidth, 20);
        ctx.strokeRect(tagX + 0.5, hy - 9.5, hoverTagWidth - 1, 19);
        ctx.fillStyle = chartColor("#171923", theme);
        ctx.save();
        ctx.textAlign = "right";
        ctx.fillText(fmtAxis(hoverPrice), W - 17, hy + 4);
        ctx.restore();
      }
      if (hover.candle) {
        const d = new Date(hover.candle.t);
        const label = d.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const tw = ctx.measureText(label).width + 12;
        const tx = Math.min(hover.x + 8, padL + chartW - tw);
        ctx.fillStyle = chartColor("rgba(255, 255, 255, 0.98)", theme);
        ctx.strokeStyle = chartColor("#858b98", theme);
        ctx.fillRect(tx, rsiTop + rsiH - 24, tw, 20);
        ctx.strokeRect(tx, rsiTop + rsiH - 24, tw, 20);
        ctx.fillStyle = chartColor("#171923", theme);
        ctx.fillText(label, tx + 6, rsiTop + rsiH - 10);
      }
    }
  }, [theme, candles, view, hover, chartType, riskLines, heatmap, volumeOn, noVolume, rsi, details]);

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(draw);
    if (wrapRef.current) observer.observe(wrapRef.current);
    if (overlayRef.current) observer.observe(overlayRef.current);
    return () => observer.disconnect();
  }, [draw]);

  // Same layout the draw step uses, so mouse and keyboard land on the drawn candles.
  function layout() {
    const rect = canvasRef.current.getBoundingClientRect();
    const padL = 10,
      padR = 12;
    const visible = candles.slice(
      Math.max(0, candles.length - view.bars - view.offset),
      candles.length - view.offset || undefined,
    );
    const chartW = rect.width - padL - padR;
    const barW = chartW / slotsFor(Math.max(1, visible.length), chartW);
    return { rect, padL, visible, barW };
  }

  function onMove(e) {
    const { rect, padL, visible, barW } = layout();
    if (visible.length === 0) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const candle = visible[Math.floor((x - padL) / barW)];
    setHover({ x, y, candle });
  }

  // Arrow keys walk the candles; each one is announced for screen readers.
  function onKeyDown(e) {
    const { padL, visible, barW } = layout();
    if (visible.length === 0) return;
    const current = hover?.candle ? visible.indexOf(hover.candle) : -1;
    const keys = {
      ArrowLeft: current === -1 ? visible.length - 1 : Math.max(0, current - 1),
      ArrowRight: current === -1 ? visible.length - 1 : Math.min(visible.length - 1, current + 1),
      Home: 0,
      End: visible.length - 1,
    };
    if (e.key === "Escape") {
      setHover(null);
      setAnnouncement("");
      return;
    }
    if (!(e.key in keys)) return;
    e.preventDefault();
    const index = keys[e.key];
    const candle = visible[index];
    setHover({ x: padL + index * barW + barW / 2, y: null, candle });
    const change = ((candle.c - candle.o) / candle.o) * 100;
    setAnnouncement(
      `${new Date(candle.t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}: ` +
        `open ${fmtAxis(candle.o)}, high ${fmtAxis(candle.h)}, low ${fmtAxis(candle.l)}, close ${fmtAxis(candle.c)}, ` +
        `${change >= 0 ? "up" : "down"} ${Math.abs(change).toFixed(2)}%`,
    );
  }

  const summary = (() => {
    if (candles.length === 0) return `${symbol} price chart, ${timeframe}, no data`;
    const recent = candles.slice(-view.bars);
    const low = Math.min(...recent.map((c) => c.l));
    const high = Math.max(...recent.map((c) => c.h));
    return (
      `${symbol} ${chartType === "line" ? "line" : "candlestick"} chart, ${timeframe} candles. ` +
      `Last price ${fmtAxis(candles.at(-1).c)}, range ${fmtAxis(low)} to ${fmtAxis(high)} over ${recent.length} candles. ` +
      "Use the arrow keys to read each candle."
    );
  })();

  function onLeave() {
    setHover(null);
  }

  function onWheel(e) {
    e.preventDefault();
    setView((v) => {
      const bars = Math.max(30, Math.min(400, v.bars + (e.deltaY > 0 ? 6 : -6)));
      return { bars, offset: Math.min(v.offset, Math.max(0, candles.length - bars)) };
    });
  }

  function onDown(e) {
    dragRef.current = { startX: e.clientX, offset: view.offset };
  }
  function onUp() {
    dragRef.current = null;
  }
  function onDrag(e) {
    if (!dragRef.current) return;
    const chartW = wrapRef.current.clientWidth - 10 - 64;
    const barW = chartW / view.bars;
    const dx = e.clientX - dragRef.current.startX;
    const shift = Math.round(dx / barW);
    const newOffset = Math.max(
      0,
      Math.min(Math.max(0, candles.length - view.bars), dragRef.current.offset + shift),
    );
    setView((v) => ({ ...v, offset: newOffset }));
  }

  return (
    <div className="hm-panel pm-integrated-chart flex flex-col" style={{ height: "100%" }}>
      <div className="pm-chart-overlay" ref={overlayRef}>
        <div className="pm-chart-overlay-main">
          {header}
          <ChartControls
            timeframe={timeframe}
            onTimeframe={onTimeframe}
            chartType={chartType}
            onChartType={setChartType}
            volume={volume}
            onVolume={noVolume ? undefined : setVolume}
            rsi={rsi}
            onRsi={setRsi}
            details={details}
            onDetails={setDetails}
          >
            {tools}
          </ChartControls>
          {headerEnd}
        </div>
        {overlayExtras}
      </div>
      <div ref={wrapRef} className="flex-1 relative min-h-0">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-crosshair"
          onMouseMove={(e) => {
            onMove(e);
            onDrag(e);
          }}
          onMouseLeave={() => {
            onLeave();
            onUp();
          }}
          role="img"
          tabIndex={0}
          aria-label={summary}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setHover(null);
            setAnnouncement("");
          }}
          onWheel={onWheel}
          onMouseDown={onDown}
          onMouseUp={onUp}
        />
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        {message && (
          <p className="pm-chart-message" role="status">
            {message}
          </p>
        )}
      </div>
      {details && (
        <div className="px-3.5 pb-2 pt-0.5 flex items-center justify-between shrink-0">
          <span className="text-[11px] font-mono" style={{ color: "#858b98" }}>
            Drag to explore · Scroll to zoom
          </span>
          <span className="text-[11px] font-mono" style={{ color: "#858b98" }}>
            {candles.length} {chartType === "line" ? "points" : "candles"} · {symbol} · {timeframe}
          </span>
        </div>
      )}
    </div>
  );
}
