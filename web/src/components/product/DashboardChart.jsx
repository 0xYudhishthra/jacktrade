import { useEffect, useId, useRef, useState } from 'react';
import { usdShort, timeLabel } from '@/lib/dashboardData';

// Axis values on round steps (1, 2, 2.5 or 5 × a power of ten), so the labels read $5K, $10K… instead of $9.633.
function niceTicks(lo, hi, count = 4) {
  const raw = (hi - lo) / count;
  if (!(raw > 0)) return [lo];
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number((Math.round(v / step) * step).toPrecision(12)));
  return ticks;
}

// Shared dashboard plot: price grids, axes and controls live on a single surface.
export default function DashboardChart({ series = [], height = 280, format = usdShort, xFormat = timeLabel, label, bands = [], domain, empty, zero = false, vlines = [], markers = [], watermark = false }) {
  const id = useId();
  const host = useRef(null);
  const [size, setSize] = useState({width:850,height});
  const hasPoints = series.some(s=>s.data.length);
  useEffect(()=>{
    if (!host.current) return;
    const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));
    observer.observe(host.current);
    return ()=>observer.disconnect();
  },[hasPoints]);
  const [cursor, setCursor] = useState(null);
  const points = series.flatMap(s => s.data);
  if (!points.length) return <div className="ds-chart-empty" style={{ minHeight: height }}>{empty || 'No recorded activity yet.'}</div>;
  const w = Math.max(180,size.width), h = Math.max(150,size.height-28), right = w<300?54:78, bottom = 29, top = 18, pw = w - right, ph = h - bottom - top;
  const ts = points.map(p => p.t), ys = points.flatMap(p => p.h!=null?[p.h,p.l]:[p.p]);
  const first = Math.min(...ts), last = Math.max(...ts);
  const x0 = last > first ? first : first-60000, x1 = last;
  const min = domain?.[0] ?? Math.min(...ys, ...(series.some(s => s.bars) ? [0] : []));
  const max = domain?.[1] ?? Math.max(...ys);
  // A flat series (all zeros, say) still gets a readable ±1 axis instead of ±0.15.
  const pad = domain ? 0 : max - min ? (max - min) * .15 : Math.max(1, Math.abs(max) * .015);
  const y0 = series.some(s=>s.bars) && min>=0 ? 0 : min - pad, y1 = max + pad || 1;
  const sx = t => ((t - x0) / (x1 - x0)) * pw;
  const sy = v => top + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
  const hoverT = cursor == null ? null : x0 + cursor / pw * (x1 - x0);
  const selected = series.map(s => s.data.reduce((best, p) => !best || Math.abs(p.t - hoverT) < Math.abs(best.t - hoverT) ? p : best, null));
  return <div ref={host} className="ds-chart" style={{ minHeight: height }}>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} preserveAspectRatio="none"
      onPointerMove={e => { const r=e.currentTarget.getBoundingClientRect(); setCursor(Math.max(0, Math.min(pw, (e.clientX-r.left)/r.width*w))); }}
      onPointerLeave={() => setCursor(null)}>
      <defs><clipPath id={id}><rect width={pw} height={top+ph}/></clipPath></defs>
      {niceTicks(y0, y1).map((v) => <g key={v}><line x1="0" x2={pw} y1={sy(v)} y2={sy(v)} className="ds-grid-line"/><text x={pw+10} y={sy(v)+4}>{format(v)}</text></g>)}
      <line x1={pw} x2={pw} y1="0" y2={top+ph} className="ds-axis"/>
      <line x1="0" x2={pw} y1={top+ph} y2={top+ph} className="ds-axis"/>
      {Array.from({length:w<300?3:5},(_,i) => <text key={i} x={8+(pw-30)*i/(w<300?2:4)} y={h-8} textAnchor={i===0?'start':i===(w<300?2:4)?'end':'middle'}>{xFormat(x0+(x1-x0)*i/(w<300?2:4))}</text>)}
      <g clipPath={`url(#${id})`}>
        {watermark&&<text x={pw/2} y={top+ph*.5} textAnchor="middle" style={{fontSize:Math.min(100,pw/7),fill:'#8995a6',opacity:.045}}>jacktrade</text>}
        {vlines.map((line,i)=><line key={`v-${i}`} x1={sx(line.t)} x2={sx(line.t)} y1={top} y2={top+ph} stroke={line.color||'#687080'} strokeDasharray="3 4"/>)}
        {bands.map((b,i)=><rect key={i} x="0" width={pw} y={sy(b.high)} height={Math.max(0,sy(b.low)-sy(b.high))} fill={b.color||'#9dc5ff'} opacity={b.opacity ?? .12}/>)}
        {zero && y0<0 && y1>0 && <line x1="0" x2={pw} y1={sy(0)} y2={sy(0)} stroke="#858b98"/>}
        {series.map((s,i)=>{const data=s.data.length===1?[s.data[0],{...s.data[0],t:x1}]:s.data;
          const visibleData=s.data.length===1?[{...s.data[0],t:x0},s.data[0]]:data;
          const path=visibleData.map((p,j)=>`${j?'L':'M'}${sx(p.t)},${sy(p.p)}`).join(' ');
          return <g key={i}>
            {s.candles ? data.map((c,j)=>{const bw=Math.max(1,pw/data.length*.6);return <g key={j} stroke="var(--theme-secondary)" strokeWidth=".8"><line x1={sx(c.t)} x2={sx(c.t)} y1={sy(c.h)} y2={sy(c.l)}/><rect x={sx(c.t)-bw/2} width={bw} y={sy(Math.max(c.o,c.c))} height={Math.max(1,Math.abs(sy(c.o)-sy(c.c)))} fill={c.c>=c.o?'var(--theme-surface)':'var(--theme-secondary)'}/></g>;}) : s.bars ? data.map((p,j)=><rect key={j} x={sx(p.t)-pw/data.length*.32} width={Math.max(2,pw/data.length*.64)} y={Math.min(sy(0),sy(p.p))} height={Math.abs(sy(0)-sy(p.p))} fill={s.color||'#254a87'} opacity=".85"/>) : <>
              {s.fill && <path d={`${path} L${sx(visibleData.at(-1).t)},${top+ph} L${sx(visibleData[0].t)},${top+ph} Z`} fill={s.color||'#254a87'} opacity=".09"/>}
              <path d={path} fill="none" stroke={s.color||'var(--theme-secondary)' } strokeWidth="1.7" vectorEffect="non-scaling-stroke"/>
              <circle cx={sx(visibleData.at(-1).t)} cy={sy(data.at(-1).p)} r="3" fill={s.color||'var(--theme-secondary)' }/>
            </>}
          </g>;
        })}
        {cursor!=null && <line x1={cursor} x2={cursor} y1="0" y2={top+ph} stroke="#858b98" strokeDasharray="3 4"/>}
      </g>
      {markers.filter(m=>m.value>=y0&&m.value<=y1).map((m,i)=><g key={i}><line x1="0" x2={pw} y1={sy(m.value)} y2={sy(m.value)} stroke={m.color||'#687080'} strokeDasharray="2 3"/><rect x={pw+2} y={sy(m.value)-8} width={right-5} height="16" fill={m.color||'#254a87'}/><text x={pw+6} y={sy(m.value)+4} style={{fill:'#ffffff',fontSize:10}}>{m.label||format(m.value)}</text></g>)}
    </svg>
    {cursor!=null && <div className="ds-chart-tooltip">{xFormat(hoverT)} {series.map((s,i)=><span key={i} style={{color:s.color}}>{s.name}: {format(selected[i]?.p||0)}</span>)}</div>}
    <div className="ds-chart-legend">{series.map((s,i)=><span key={i}><i style={{background:s.color||'var(--theme-secondary)' }}/>{s.name} <b>{format(s.data.at(-1)?.p||0)}</b></span>)}</div>
  </div>;
}
export function StatRows({ rows }) {
  return <dl className="ds-stat-rows">{rows.map(([label,value,tone])=><div key={label}><dt>{label}</dt><dd className={tone ? `pm-${tone}` : undefined}>{value}</dd></div>)}</dl>;
}
