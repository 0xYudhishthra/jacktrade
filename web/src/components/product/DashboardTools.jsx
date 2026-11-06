import { useRef } from 'react';
import { FilterSelect } from './ProductUI';
import DashboardChart from './DashboardChart';
export function ChartTools({label,range,onRange,ranges=[['1h','1H'],['1d','1D'],['7d','7D']],paused,onPause,children,badge}){
  return <div className="ds-chart-controls">{badge}{children}<FilterSelect label={label} value={range} onChange={value=>{onRange(value);if(paused)onPause(false);}} items={ranges}/>{onPause&&<button className="ds-live-toggle" aria-label={paused?'Resume '+label:'Pause '+label} aria-pressed={paused} onClick={()=>onPause(!paused)}>{paused?'RESUME':'Ⅱ PAUSE'}</button>}</div>;
}
export function SnapshotChart({paused,...props}){
  const frozen=useRef(props);
  if(!paused)frozen.current=props;
  return <DashboardChart {...frozen.current}/>;
}
export function ActivityTable({rows=[],empty='No activity yet.'}){
  return <><div className="pm-table-scroll"><table className="pm-table"><thead><tr><th>Date / time</th><th>Type</th><th>Asset</th><th>Amount</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{new Date(row.time).toLocaleString()}</td><td><span className="ds-source-tag">{row.type}</span></td><td>{row.market||row.unit}</td><td>{Number(row.amount).toLocaleString('en-US',{maximumFractionDigits:4})} {row.unit}</td></tr>)}</tbody></table></div>{!rows.length&&<div className="pm-empty">{empty}</div>}</>;
}
export function DataError({error,onRetry,what='data'}){
  return <div className="pm-empty" role="alert">Couldn't load {what}: {error} {onRetry&&<button type="button" className="pm-text-button" onClick={onRetry}>Retry</button>}</div>;
}
