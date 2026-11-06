import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTradingSession } from '@/hooks/useTradingSession';
import { usePolledData } from '@/hooks/useBackendAccount';
import { fetchActivity } from '@/lib/jacktradeApi';
import { mapActivityPage } from '@/lib/accountActivity';
import { money,compact, rewardUsd } from '@/lib/protocolModel';
import { StatRows } from './DashboardChart';
import { ActivityTable, DataError } from './DashboardTools';
import Positions from './Positions';
const VIEWS=[['positions','Open Positions'],['history','Trade History'],['transfers','Deposits / Withdrawals'],['staking','Staking'],['queue','Open Queue Balances'],['queue-history','Queue Balance History'],['emissions','HOUSE Emissions'],['rewards','Rewards']];
// Activity kinds per view (GET /api/activity shortcuts).
const KINDS={transfers:'transfers',staking:'staking',emissions:'mint','queue-history':'queue'};
const EMPTY={transfers:'No deposits or withdrawals yet.',staking:'No staking activity yet.',emissions:'No HOUSE emissions yet.','queue-history':'No queue balance history.'};
const PAGE=25;
export default function PortfolioDetails(){
  const {account}=useTradingSession();
  const [view,setView]=useState('positions');
  // Cursor of each page already visited: [undefined (newest), next of page 1, next of page 2, …].
  const [cursors,setCursors]=useState([undefined]);
  const page=cursors.length-1,cursor=cursors.at(-1);
  const user=account.protocol?.wallet;
  const kind=KINDS[view];
  const feed=usePolledData(kind&&user?`${view}:${user}:${cursor??''}`:null,()=>fetchActivity({user,kind,limit:PAGE,cursor}).then(mapActivityPage),15_000);
  const rows=feed.data?.rows??[];
  const open=(id)=>{setView(id);setCursors([undefined]);};
  return <section className="jt-panel ds-portfolio-details">
    <div className="ds-detail-tabs" role="tablist" aria-label="Portfolio views">{VIEWS.map(([id,label])=><button key={id} id={`portfolio-${id}`} role="tab" aria-selected={view===id} aria-controls="portfolio-detail-content" onClick={()=>open(id)}>{label}</button>)}<button className="ds-close-all" disabled={!account.positions.length} onClick={()=>account.positions.forEach(p=>account.closePosition(p.id))}>Close all</button></div>
    <div id="portfolio-detail-content" role="tabpanel" aria-labelledby={`portfolio-${view}`}>
      {(view==='positions'||view==='history')&&<Positions key={view} hideTabs embedded historyOnly={view==='history'}/>}
      {kind&&(!user?<div className="pm-empty">Connect your wallet to see your activity.</div>:feed.error&&!feed.data?<DataError what="activity" error={feed.error} onRetry={feed.retry}/>:feed.loading?<div className="pm-empty">Loading…</div>:<ActivityTable rows={rows} empty={page?'No more entries.':EMPTY[view]}/>)}
      {view==='queue'&&<><div className="pm-table-scroll"><table className="pm-table"><thead><tr><th>Place in line</th><th>Waiting</th><th>Ahead of you</th><th>Status</th></tr></thead><tbody>{account.queue.map(q=><tr key={q.id}><td>#{q.position}</td><td>${money(q.amount)}</td><td>${money(q.ahead)}</td><td>Queued · FIFO</td></tr>)}</tbody></table></div>{!account.queue.length&&<div className="pm-empty">No open queue balances.</div>}</>}
      {view.includes('queue')&&<Link to="/house" className="ds-inline-link ds-detail-link">View house liquidity ↗</Link>}
      {view==='rewards'&&<div className="ds-rewards-detail"><StatRows rows={[["Claimable USDG",rewardUsd(account.claimable)],["Claimed USDG",rewardUsd(account.claimed)],["HOUSE balance",compact(account.token)],["Staked HOUSE",compact(account.staked)]]}/><Link to="/token" className="luna-btn">Manage staking & rewards ↗</Link></div>}
    </div>
    {kind&&user&&<div className="ds-pagination"><span>{rows.length} entries</span><button disabled={!page} onClick={()=>setCursors(cursors.slice(0,-1))}>← Previous</button><span>Page {page+1}</span><button disabled={!feed.data?.next} onClick={()=>setCursors([...cursors,feed.data.next])}>Next →</button></div>}
  </section>;
}
