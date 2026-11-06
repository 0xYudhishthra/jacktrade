import { formatUnits, type Hex } from "viem";

import { estimatePnl, WINDOWS, type Window } from "../leaderboard/rules.js";

/** Pure logic for the feed and chart routes (src/api/feeds.ts): grids, buckets and the house exposure. */

const usd = (v: bigint) => formatUnits(v, 6);
const px = (v: bigint) => formatUnits(v, 18);

export const INTERVALS = { "5m": 300, "15m": 900, "1h": 3_600, "4h": 14_400, "1d": 86_400 } as const;
export type Interval = keyof typeof INTERVALS;
const DEFAULT_INTERVAL: Record<Window, Interval> = { "24h": "15m", "7d": "1h", "30d": "4h", all: "1d" };
export const MAX_BUCKETS = 500;

type Bad = { ok: false; message: string };
const bad = (message: string): Bad => ({ ok: false, message });

/** Strict query like the leaderboard: only the listed params, once each. */
export function strict(search: URLSearchParams, allowed: string[]): Bad | undefined {
  const seen = new Set<string>();
  for (const key of search.keys()) {
    if (!allowed.includes(key)) return bad(`Unknown query parameter "${key}". Allowed: ${allowed.join(", ")}.`);
    if (seen.has(key)) return bad(`Query parameter "${key}" is repeated.`);
    seen.add(key);
  }
}

/** window + interval → the bucket grid. `all` starts at the first event (`firstAt`). */
export function parseSeries(search: URLSearchParams, firstAt: number, at = Math.floor(Date.now() / 1000)): ({ ok: true } & { window: Window; interval: Interval; step: number; from: number; to: number }) | Bad {
  const window = (search.get("window") ?? "7d") as Window;
  if (!Object.hasOwn(WINDOWS, window)) return bad(`window must be one of: ${Object.keys(WINDOWS).join(", ")}.`);
  const interval = (search.get("interval") ?? DEFAULT_INTERVAL[window]) as Interval;
  if (!Object.hasOwn(INTERVALS, interval)) return bad(`interval must be one of: ${Object.keys(INTERVALS).join(", ")}.`);
  const step = INTERVALS[interval];
  const to = Math.floor(at / step) * step;
  const rawFrom = WINDOWS[window] === 0 ? Math.min(firstAt, at) : at - WINDOWS[window];
  const from = Math.floor(rawFrom / step) * step;
  if ((to - from) / step + 1 > MAX_BUCKETS) return bad(`Too many points: use a bigger interval (at most ${MAX_BUCKETS} per request).`);
  return { ok: true, window, interval, step, from, to };
}

/**
 * Last value per bucket, carried forward over empty buckets. `start` is the value before the first bucket (or null if
 * nothing happened yet). Rows must be sorted by time.
 */
export function fillBuckets<T>(rows: { t: number; v: T }[], from: number, to: number, step: number, start: T | null): { t: number; v: T | null }[] {
  const out: { t: number; v: T | null }[] = [];
  let i = 0;
  let last = start;
  for (let t = from; t <= to; t += step) {
    while (i < rows.length && rows[i]!.t < t + step) last = rows[i++]!.v;
    out.push({ t, v: last });
  }
  return out;
}

/** Sum per bucket (empty buckets are 0). */
export function sumBuckets(rows: { t: number; v: bigint }[], from: number, to: number, step: number) {
  const sums = new Map<number, bigint>();
  for (const r of rows) {
    const b = Math.floor(r.t / step) * step;
    sums.set(b, (sums.get(b) ?? 0n) + r.v);
  }
  const out: { t: number; v: bigint }[] = [];
  for (let t = from; t <= to; t += step) out.push({ t, v: sums.get(t) ?? 0n });
  return out;
}

const LEVERAGE_BUCKETS = [
  [1, 9],
  [10, 49],
  [50, 99],
  [100, 249],
  [250, 499],
  [500, 999],
  [1000, Infinity],
] as const;
const SHOCKS = [-10, -5, -2, -1, 1, 2, 5, 10];
const LIQ_BINS = 40;

export type OpenRow = { user: Hex; instrumentId: number; isLong: boolean; margin: bigint; leverage: bigint; notional: bigint; entryPrice: bigint };

/** Liquidation price with the market's current buffer (same formula as shared/positions). */
function liqPrice(p: OpenRow, bufferBps: number) {
  const dist = p.entryPrice / p.leverage - (p.entryPrice * BigInt(bufferBps)) / 10_000n;
  return p.isLong ? p.entryPrice - dist : p.entryPrice + dist;
}

/** Exposure of one market from its open positions. Pure, so it can be tested. */
export function exposure(rows: OpenRow[], price: bigint | undefined, bufferBps: number | undefined) {
  const side = (long: boolean) => rows.filter((p) => p.isLong === long);
  const total = (list: OpenRow[], f: (p: OpenRow) => bigint) => list.reduce((s, p) => s + f(p), 0n);
  const leverage = LEVERAGE_BUCKETS.map(([min, max]) => {
    const inside = rows.filter((p) => Number(p.leverage) >= min && Number(p.leverage) <= max);
    return {
      min,
      max: Number.isFinite(max) ? max : null,
      positions: inside.length,
      longNotional: usd(total(inside.filter((p) => p.isLong), (p) => p.notional)),
      shortNotional: usd(total(inside.filter((p) => !p.isLong), (p) => p.notional)),
    };
  });

  let unrealized: bigint | null = null;
  let shocks: { move: number; houseDelta: string }[] = [];
  let liquidationMap: { from: string; to: string; longNotional: string; shortNotional: string; positions: number }[] = [];
  if (price !== undefined) {
    const at = (q: bigint) => rows.reduce((s, p) => s + estimatePnl(p, q), 0n);
    unrealized = at(price);
    // What the house would win (+) or lose (−) if the price moved that much right now (traders' estimate, opposite sign).
    shocks = SHOCKS.map((m) => ({ move: m, houseDelta: usd(-(at((price * BigInt(100 + m)) / 100n) - unrealized!)) }));
    if (bufferBps !== undefined && rows.length) {
      // Notional that gets liquidated in each price band, ±50 % around the current price.
      const lo = price / 2n;
      const hi = price + price / 2n;
      const width = (hi - lo) / BigInt(LIQ_BINS);
      const bins = Array.from({ length: LIQ_BINS }, (_, i) => ({ from: lo + width * BigInt(i), long: 0n, short: 0n, n: 0 }));
      for (const p of rows) {
        const lp = liqPrice(p, bufferBps);
        if (lp < lo || lp >= hi || width === 0n) continue;
        const b = bins[Math.min(Number((lp - lo) / width), LIQ_BINS - 1)]!;
        if (p.isLong) b.long += p.notional;
        else b.short += p.notional;
        b.n++;
      }
      liquidationMap = bins.map((b) => ({ from: px(b.from), to: px(b.from + width), longNotional: usd(b.long), shortNotional: usd(b.short), positions: b.n }));
    }
  }
  return {
    positions: rows.length,
    longPositions: side(true).length,
    shortPositions: side(false).length,
    longOi: usd(total(side(true), (p) => p.notional)),
    shortOi: usd(total(side(false), (p) => p.notional)),
    margin: usd(total(rows, (p) => p.margin)),
    traderUnrealizedPnl: unrealized === null ? null : usd(unrealized),
    leverage,
    shocks,
    liquidationMap,
  };
}

