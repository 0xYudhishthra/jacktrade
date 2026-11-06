export const usdShort = (n) => (n<0?'−$':'$') + Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(Math.abs(n || 0));
export const numberShort = (n) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
export const timeLabel = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// Chart range -> API window (/api/pnl, /api/leaderboard). The API has no 1h window.
export const API_WINDOW = { '1d': '24h', '7d': '7d', '30d': '30d', all: 'all' };
const WINDOW_MS = { '24h': 864e5, '7d': 6048e5, '30d': 2592e6 };

// GET /api/pnl/:user -> chart points [{t, p}]. key: 'equity' (net deposits + realized PnL) or 'realizedPnl'.
// The line starts at the window's opening value and is carried to now; an account with no events is empty.
export function pnlChartSeries(data, key = 'equity', now = Date.now()) {
  if (!data) return [];
  const events = (data.points || []).map((p) => ({ t: Number(p.at) * 1000, p: Number(p[key] ?? 0) }));
  const start = Number(data.start?.[key] ?? 0);
  const span = WINDOW_MS[data.window];
  if (!events.length && (!span || (start === 0 && Number(data.start?.equity ?? 0) === 0))) return [];
  const out = [];
  if (span && (!events.length || events[0].t > now - span)) out.push({ t: now - span, p: start });
  out.push(...events);
  if (out.at(-1).t < now) out.push({ t: now, p: out.at(-1).p });
  return out;
}

// Closed trades (GET /api/history items, or the account's mapped history) -> real summary numbers.
export function tradeSummary(items = [], best = 5) {
  const trades = items.filter((i) => i.type === 'close' || i.type === 'liquidation');
  const num = (v) => Number(v ?? 0);
  const leverage = trades.reduce((s, t) => s + num(t.leverage), 0);
  return {
    trades: trades.length,
    wins: trades.filter((t) => num(t.pnl) > 0).length,
    liquidations: trades.filter((t) => t.type === 'liquidation').length,
    realized: trades.reduce((s, t) => s + num(t.pnl), 0),
    avgLeverage: trades.length ? leverage / trades.length : null,
    best: [...trades].sort((a, b) => num(b.pnl) - num(a.pnl)).slice(0, best),
  };
}

// 0x followed by 40 hex characters.
export const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value || '');
export const shortAddress = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '');
