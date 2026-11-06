function fmtPrice(p) {
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}
function fmt(n, d = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default function TradeHistoryTab({ history }) {
  if (history.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[12px] font-mono" style={{ color: 'var(--terminal-muted)' }}>No trade history yet.</p>
      </div>
    );
  }
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr style={{ background: '#EAF4FF', color: 'var(--terminal-secondary)' }}>
          {['Time', 'Market', 'Side', 'Size', 'Entry', 'Exit', 'Realized PnL'].map((h) => (
            <th key={h} className="px-3 py-2 text-left font-mono font-semibold text-[10px] uppercase tracking-wider">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {history.map((h) => {
          const up = h.pnl >= 0;
          return (
            <tr key={h.id} style={{ borderBottom: '1px solid #EAF4FF' }}>
              <td className="px-3 py-2 font-mono" style={{ color: 'var(--terminal-muted)' }}>{new Date(h.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              <td className="px-3 py-2 font-semibold" style={{ color: 'var(--terminal-text)' }}>{h.symbol}</td>
              <td className="px-3 py-2"><span className="text-[10px] font-mono font-bold" style={{ color: h.side === 'long' ? 'var(--terminal-up)' : 'var(--terminal-down)' }}>{h.side.toUpperCase()}</span></td>
              <td className="px-3 py-2 font-mono tabular-nums" style={{ color: 'var(--terminal-secondary)' }}>{h.size.toFixed(4)}</td>
              <td className="px-3 py-2 font-mono tabular-nums" style={{ color: 'var(--terminal-secondary)' }}>{fmtPrice(h.entry)}</td>
              <td className="px-3 py-2 font-mono tabular-nums" style={{ color: 'var(--terminal-secondary)' }}>{fmtPrice(h.exit)}</td>
              <td className="px-3 py-2 font-mono tabular-nums font-semibold" style={{ color: up ? 'var(--terminal-up)' : 'var(--terminal-down)' }}>{up ? '+' : ''}{fmt(h.pnl)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}