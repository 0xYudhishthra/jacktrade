import { useTheme } from "@/components/dream/ThemeProvider";
import { chartColor } from "@/lib/chartTheme";
import { useEffect, useRef, useState } from "react";
import ChartControls from "@/components/product/ChartControls";
import { reduceMotion } from "@/lib/matrixMotion";

// Live tick chart (papertrade / Polymarket style): the last minute of prices received while the
// page is open. It animates on every frame so it moves organically: a smooth monotone curve, the
// newest point gliding to each new price, the time window and price scale easing instead of
// jumping, and a short green/red tint that fades back to the ink.
const EMPTY = [];
const NORMAL = [32, 38, 49]; // #202631
const UP = [24, 150, 104]; // green, close to the candles' #12a172
const DOWN = [214, 66, 88]; // red, close to the candles' #e5485f
const PAD = { top: 92, right: 12, bottom: 28, left: 0 };
const WINDOW_MS = 60_000; // only the last minute is shown
const MIN_SPAN_MS = 5_000; // right after load, don't stretch a couple of ticks across the chart
const HEADROOM = 0.08; // empty space after "now", like papertrade
const GLIDE_MS = 520; // newest point easing to a new price
const TINT_MS = 900; // green/red tint fading back to the ink
const SCALE_EASE_MS = 260; // price scale easing toward its target range

const easeOut = (t) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);
const rgb = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
// One fixed precision per market so axis labels line up (768.954 and 768.848, never 768.9537 next to 768.848).
const fmtPrice = (p) => {
  const digits = p >= 1000 ? 2 : 3;
  return p.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtTime = (t) =>
  new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Ticks inside the window plus the one just before it, so the line enters from the left edge.
function windowed(ticks, now) {
  if (ticks.length === 0) return [];
  const start = now - WINDOW_MS;
  const firstInside = ticks.findIndex((t) => t.time >= start);
  return firstInside === -1 ? [ticks.at(-1)] : ticks.slice(Math.max(0, firstInside - 1));
}

function priceRange(prices, lines) {
  const last = prices.at(-1);
  const nearby = lines.map((l) => l.price).filter((p) => Math.abs(p / last - 1) < 0.05);
  let lo = Math.min(...prices, ...nearby);
  let hi = Math.max(...prices, ...nearby);
  // Tight floor (~$1.6 on BTC) so second-to-second moves are visible, like papertrade.
  const minRange = last * 0.00002;
  if (hi - lo < minRange) {
    const mid = (hi + lo) / 2;
    lo = mid - minRange / 2;
    hi = mid + minRange / 2;
  }
  const pad = (hi - lo) * 0.12;
  return [lo - pad, hi + pad];
}

// Monotone cubic (Fritsch–Carlson): smooth, but never overshoots the real prices.
function monotonePath(points) {
  const path = new Path2D();
  const n = points.length;
  if (n === 0) return path;
  path.moveTo(points[0].x, points[0].y);
  if (n === 1) return path;
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    slope[i] = dx[i] > 0 ? (points[i + 1].y - points[i].y) / dx[i] : 0;
  }
  const tangent = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  tangent[n - 1] = slope[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      tangent[i] = k * a * slope[i];
      tangent[i + 1] = k * b * slope[i];
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    path.bezierCurveTo(
      points[i].x + h,
      points[i].y + tangent[i] * h,
      points[i + 1].x - h,
      points[i + 1].y - tangent[i + 1] * h,
      points[i + 1].x,
      points[i + 1].y,
    );
  }
  return path;
}

function drawFrame(canvas, size, state, frameTime, reduced, clock = Date.now()) {
  const { theme } = state;
  const normal = theme === "dark" ? [193, 213, 239] : NORMAL;
  const { width, height, dpr } = size;
  if (!canvas || width === 0) return;
  const { ticks: allTicks, riskLines: lines, status: feed, hover } = state;
  const a = state.anim;
  const dt = a.lastFrame ? frameTime - a.lastFrame : 16;
  a.lastFrame = frameTime;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px 'Geist Mono', monospace";

  // Watermark.
  ctx.save();
  ctx.fillStyle = chartColor("rgba(37, 74, 135, 0.035)", theme);
  ctx.font = `${Math.round(Math.min(width / 7, 96))}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("jacktrade", (width - PAD.right) / 2, height / 2 + 20);
  ctx.restore();

  if (allTicks.length === 0 || a.to === null) {
    ctx.fillStyle = chartColor("#687080", theme);
    ctx.textAlign = "center";
    ctx.fillText(
      feed === "offline" ? "Price feed offline · reconnecting…" : "Waiting for prices…",
      (width - PAD.right) / 2,
      height / 2,
    );
    return;
  }

  // Newest price glides toward its target.
  const glide = reduced ? 1 : easeOut((frameTime - a.glideStart) / GLIDE_MS);
  a.price = a.from + (a.to - a.from) * glide;

  // Time window slides continuously with the clock.
  const now = Math.max(clock, allTicks.at(-1).time);
  const visible = windowed(allTicks, now);
  const series = visible.map((t, i) => (i === visible.length - 1 ? { ...t, price: a.price } : t));
  series.push({ time: now, price: a.price });
  const x0 = Math.min(Math.max(now - WINDOW_MS, series[0].time), now - MIN_SPAN_MS);
  const plotW = width - PAD.left - PAD.right;
  ctx.font = "bold 12px 'Geist Mono', monospace";
  const priceTagWidth = Math.ceil(ctx.measureText(fmtPrice(a.to)).width) + 14;
  ctx.font = "12px 'Geist Mono', monospace";
  // Prices float inside the plot; leave future time beneath them, not a separate axis column.
  const labelRoom = priceTagWidth + 24;
  const headroom = Math.max(HEADROOM, labelRoom / Math.max(1, plotW - labelRoom));
  const x1 = now + (now - x0) * headroom;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (t) => PAD.left + ((t - x0) / (x1 - x0)) * plotW;

  // Price scale eases toward the range it should show.
  const [targetLo, targetHi] = priceRange(
    series.map((t) => t.price),
    lines,
  );
  if (a.lo === null || reduced) {
    a.lo = targetLo;
    a.hi = targetHi;
  } else {
    const k = 1 - Math.exp(-dt / SCALE_EASE_MS);
    a.lo += (targetLo - a.lo) * k;
    a.hi += (targetHi - a.hi) * k;
  }
  const lo = a.lo;
  const hi = a.hi;
  const y = (p) => PAD.top + (1 - (p - lo) / (hi - lo)) * plotH;

  const tintT = a.tint && !reduced ? easeOut((frameTime - a.tintStart) / TINT_MS) : 1;
  const color = a.tint ? mix(a.tint, normal, tintT) : normal;

  // One continuous grid, with prices inset at its right edge.
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const price = lo + ((hi - lo) * i) / steps;
    const gy = y(price);
    ctx.strokeStyle = chartColor("rgba(104, 112, 128, 0.10)", theme);
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, gy);
    ctx.lineTo(width - PAD.right, gy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = chartColor("#687080", theme);
    if (Math.abs(gy - y(a.price)) > 23) ctx.fillText(fmtPrice(price), width - 10, gy);
  }

  // Time axis: labels on whole seconds so they slide with the window instead of reshuffling.
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = chartColor("#687080", theme);
  const slots = Math.max(2, Math.floor(plotW / 140));
  const every = Math.max(2, Math.ceil((x1 - x0) / 1000 / slots));
  const firstLabel = Math.ceil(x0 / 1000 / every) * every * 1000;
  for (let t = firstLabel; t <= x1; t += every * 1000) {
    const lx = x(t);
    if (lx < 34 || lx > width - PAD.right - 34) continue;
    ctx.fillText(fmtTime(t), lx, height - 8);
  }

  // Area and smooth line, clipped so the entry point off the left edge stays hidden.
  const points = series.map((t) => ({ x: x(t.time), y: y(t.price) }));
  const line = monotonePath(points);
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, 0, plotW, height);
  ctx.clip();
  const area = new Path2D(line);
  area.lineTo(points.at(-1).x, height - PAD.bottom);
  area.lineTo(points[0].x, height - PAD.bottom);
  area.closePath();
  const gradient = ctx.createLinearGradient(0, PAD.top, 0, height - PAD.bottom);
  gradient.addColorStop(0, rgb(color, 0.045));
  gradient.addColorStop(1, rgb(color, 0));
  ctx.fillStyle = gradient;
  ctx.fill(area);
  ctx.strokeStyle = rgb(color);
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(line);
  ctx.lineWidth = 1;
  ctx.restore();

  // Position lines (entry, liquidation, TP/SL).
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  for (const risk of lines) {
    if (risk.price < lo || risk.price > hi) continue;
    const ry = y(risk.price);
    ctx.strokeStyle = risk.color;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, ry);
    ctx.lineTo(width - PAD.right, ry);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = risk.color;
    ctx.fillText(risk.label, PAD.left + 8, ry - 3);
  }

  // Current price: dashed guide, axis tag and a softly breathing end dot.
  const end = points.at(-1);
  ctx.strokeStyle = rgb(color, 0.6);
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(width - 10 - priceTagWidth, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = rgb(color);
  ctx.fillRect(width - 10 - priceTagWidth, end.y - 11, priceTagWidth, 22);
  ctx.fillStyle = chartColor("#ffffff", theme);
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.font = "bold 12px 'Geist Mono', monospace";
  ctx.fillText(fmtPrice(a.to), width - 17, end.y);
  ctx.font = "12px 'Geist Mono', monospace";
  const breathe = 0;
  ctx.fillStyle = rgb(color, 0.18 + breathe * 0.14);
  ctx.beginPath();
  ctx.arc(end.x, end.y, 7 + breathe * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(color);
  ctx.beginPath();
  ctx.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Hover crosshair and tooltip on the nearest real tick.
  if (hover !== null) {
    const target = x0 + ((hover - PAD.left) / plotW) * (x1 - x0);
    let nearest = visible.at(-1);
    for (const t of visible) {
      if (Math.abs(t.time - target) < Math.abs(nearest.time - target)) nearest = t;
    }
    const hx = x(nearest.time);
    const hy = y(nearest.price);
    ctx.strokeStyle = chartColor("rgba(104, 112, 128, 0.35)", theme);
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(hx, PAD.top - 20);
    ctx.lineTo(hx, height - PAD.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = chartColor("#171923", theme);
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    ctx.fill();
    const text = `${fmtPrice(nearest.price)}  ·  ${fmtTime(nearest.time)}`;
    const boxW = ctx.measureText(text).width + 18;
    const bx = Math.min(Math.max(hx - boxW / 2, 4), width - PAD.right - boxW - 4);
    const by = Math.max(hy - 36, PAD.top - 30);
    ctx.fillStyle = chartColor("rgba(255, 255, 255, 0.97)", theme);
    ctx.strokeStyle = chartColor("rgba(37, 74, 135, 0.2)", theme);
    ctx.fillRect(bx, by, boxW, 22);
    ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, 21);
    ctx.fillStyle = chartColor("#171923", theme);
    ctx.textAlign = "left";
    ctx.fillText(text, bx + 9, by + 11);
  }
}

const freshAnim = () => ({
  price: null,
  from: null,
  to: null,
  glideStart: 0,
  tint: null,
  tintStart: 0,
  lo: null,
  hi: null,
  lastFrame: 0,
});

export default function TickChart({
  symbol,
  ticks = EMPTY,
  status,
  header,
  headerEnd,
  overlayExtras,
  riskLines = EMPTY,
  tools,
  timeframe,
  onTimeframe,
  motionPreference = "system",
}) {
  const { theme } = useTheme();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  // Everything the animation loop reads lives in one ref so frames never wait on React renders.
  const state = useRef({ theme, ticks, riskLines, status, hover: null, anim: freshAnim() });
  const size = useRef({ width: 0, height: 0, dpr: 1 });
  const [label, setLabel] = useState("");

  useEffect(() => {
    Object.assign(state.current, { theme, ticks, riskLines, status });
  }, [theme, ticks, riskLines, status]);

  // A new market starts fresh instead of gliding from the previous market's price.
  useEffect(() => {
    state.current.anim = freshAnim();
  }, [symbol]);

  // Each new tick starts a glide from wherever the line is to the new price, with a brief tint.
  const last = ticks.at(-1);
  const prev = ticks.at(-2);
  useEffect(() => {
    if (!last) return;
    const a = state.current.anim;
    const now = performance.now();
    if (a.to === null) {
      a.price = a.from = a.to = last.price;
    } else if (last.price !== a.to) {
      a.from = a.price;
      a.to = last.price;
      a.glideStart = now;
      if (prev) {
        a.tint = last.price > prev.price ? UP : DOWN;
        a.tintStart = now;
      }
    }
    setLabel(`${symbol} ${status === "simulated" ? "simulated" : "live"} tick chart, last price ${fmtPrice(last.price)}`);
  }, [last, prev, symbol, status]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      size.current = { width, height, dpr };
    });
    observer.observe(wrap);
    let raf;
    const frame = (time) => {
      const reduced = motionPreference === "app" ? reduceMotion(media) : media.matches;
      const clock = motionPreference === "app" && reduced ? state.current.ticks.at(-1)?.time : undefined;
      drawFrame(canvas, size.current, state.current, time, reduced, clock);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [motionPreference]);

  function onMove(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    const px = event.clientX - rect.left;
    state.current.hover = px > rect.width - PAD.right ? null : px;
  }

  return (
    <div className="hm-panel pm-integrated-chart pm-tick-chart flex flex-col" style={{ height: "100%" }}>
      <div className="pm-chart-overlay">
        <div className="pm-chart-overlay-main">
          {header}
          <ChartControls timeframe={timeframe} onTimeframe={onTimeframe}>
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
          onMouseMove={onMove}
          onMouseLeave={() => {
            state.current.hover = null;
          }}
          role="img"
          aria-label={label || `${symbol} live tick chart, waiting for prices`}
        />
      </div>
    </div>
  );
}
