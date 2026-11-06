import { Fragment, useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Shell, FilterSelect, useProductUI } from '@/components/product/ProductUI';
import MarketIcon from '@/components/product/MarketIcon';
import { marketBySymbol } from '@/lib/mockMarkets';
import { StatRows } from '@/components/product/DashboardChart';
import { useTradingSession } from '@/hooks/useTradingSession';
import { money, compact } from '@/lib/protocolModel';
import { fetchLeaderboardAccounts, fetchLeaderboardPositions } from '@/lib/jacktradeApi';
import { API_WINDOW, shortAddress } from '@/lib/dashboardData';

// Every row comes from the indexer (/api/leaderboard/accounts and /positions). Nothing is filled in locally.
const PAGE_SIZE = 25;
// Default API sort for each category. Liquidated and House owners only list accounts with something to show.
const CATEGORY = {
  winners: { sortKey: 'rank', desc: false },
  liquidated: { sortKey: 'liquidations', desc: true, keep: (r) => r.liquidations > 0, empty: 'No liquidations in this period.' },
  stakers: { sortKey: 'staked', desc: true, keep: (r) => Number(r.staked) > 0, empty: 'No HOUSE staked yet.' },
};
const num = (v) => (v == null ? null : Number(v));
const signed = (v) => (v == null ? '–' : (v >= 0 ? '+' : '−') + '$' + money(Math.abs(v)));
const pct = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
const ago = (sec) => {
  if (!sec) return '–';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - sec));
  return s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
const duration = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m` : `${Math.floor(sec / 60)}m ${sec % 60}s`);
const symbolOf = (market = '') => market.split('/')[0];

const toneOf = (v) => (v == null ? undefined : v >= 0 ? 'pm-up' : 'pm-down');

function accountRow(a) {
  return { ...a, id: a.user, name: a.username || shortAddress(a.user), pnl: num(a.pnl), roi: a.roi, volume: num(a.volume), margin: num(a.margin), realizedPnl: num(a.realizedPnl), unrealizedPnl: num(a.unrealizedPnl), openNotional: num(a.openNotional), queued: num(a.queued), stakingRewards: num(a.stakingRewards), staked: num(a.staked), minted: num(a.minted) };
}
function positionRow(p) {
  return { ...p, name: p.username || shortAddress(p.user), symbol: symbolOf(p.market), pnl: num(p.pnl), margin: num(p.margin), notional: num(p.notional), entry: num(p.entryPrice), exit: num(p.exitPrice), duration: Math.max(0, p.closedAt - p.openedAt) };
}

const plural = (n, word, more = false) => `${n}${more ? '+' : ''} ${word}${Number(n) === 1 && !more ? '' : 's'}`;
export default function Ranking() {
  const [type,setType]=useState('winners'),[view,setView]=useState('accounts'),[period,setPeriod]=useState('7d');
  const [search,setSearch]=useState(''),[q,setQ]=useState(''),[sort,setSort]=useState({key:'rank',desc:false}),[page,setPage]=useState(0),[expanded,setExpanded]=useState(null);
  const [data,setData]=useState(null),[status,setStatus]=useState('loading'),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const {setModal}=useProductUI();
  const {walletAddress}=useTradingSession();
  const me=walletAddress?.toLowerCase();
  const trades=view==='positions'&&type!=='stakers';
  // House owners are only listed with window=all (stakers who never traded have no activity in a window).
  const range=type==='stakers'?'all':API_WINDOW[period];
  const category=CATEGORY[type];

  useEffect(()=>{const timer=setTimeout(()=>{setQ(search.trim());setPage(0);},300);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{
    let live=true;
    setStatus('loading');setError('');
    const request=trades
      ?fetchLeaderboardPositions(range).then(body=>({positions:body.positions.map(positionRow)}))
      :fetchLeaderboardAccounts({window:range,page,q,sortKey:sort.key,sortDir:sort.desc?'desc':'asc'}).then(body=>({...body,accounts:body.accounts.map(accountRow)}));
    request.then(body=>{if(live){setData(body);setStatus('ready');}}).catch(reason=>{if(live){setData(null);setError(reason.message||'The leaderboard could not be loaded.');setStatus('error');}});
    return()=>{live=false;};
  },[trades,range,page,q,sort.key,sort.desc,attempt]);

  const reset=()=>{setPage(0);setExpanded(null);};
  const chooseType=v=>{setType(v);setSort({key:CATEGORY[v].sortKey,desc:CATEGORY[v].desc});if(v==='stakers')setView('accounts');reset();};
  // Accounts sort on the server (sortKey/sortDir); the 15 top positions sort locally.
  const [posSort,setPosSort]=useState({key:'pnl',desc:true});
  const active=trades?posSort:sort;
  const sortBy=key=>{
    if(trades){setPosSort({key,desc:posSort.key===key?!posSort.desc:true});return;}
    setSort({key,desc:sort.key===key?!sort.desc:!(key==='rank'||key==='user')});reset();
  };
  const heading=(label,key)=><th aria-sort={active.key===key?(active.desc?'descending':'ascending'):'none'}><button onClick={()=>sortBy(key)}>{label}{active.key===key?(active.desc?' ↓':' ↑'):''}</button></th>;

  const needle=search.trim().toLowerCase();
  const positions=trades&&data?.positions?data.positions
    .filter(p=>(type!=='liquidated'||p.liquidated)&&`${p.username||''} ${p.user} ${p.market}`.toLowerCase().includes(needle))
    .sort((a,b)=>{const av=a[posSort.key]??0,bv=b[posSort.key]??0;return (typeof av==='string'?av.localeCompare(bv):av-bv)*(posSort.desc?-1:1);}):[];
  const pageRows=!trades&&data?.accounts?data.accounts:[];
  const accounts=category.keep?pageRows.filter(category.keep):pageRows;
  const rows=trades?positions:accounts;
  const totalPages=!trades?data?.pageInfo?.totalPages??1:1;
  // Sorted by the category key, a filtered-out row means the rest of the list has nothing to show either.
  const more=!trades&&page<totalPages-1&&(!category.keep||sort.key!==category.sortKey||accounts.length===pageRows.length);
  const rankOf=(t,i)=>trades?t.rank:type==='winners'?t.rank??'–':page*PAGE_SIZE+i+1;
  const profileLink=t=>t.user===me?{to:'/portfolio',params:{}}:{to:'/u/$username',params:{username:t.username||t.user}};
  const share=t=>{
    const value=type==='stakers'?compact(t.staked)+' HOUSE':signed(t.pnl);
    setModal({type:'share',data:{title:t.name,value,tone:type==='stakers'?undefined:t.pnl>=0?'up':'down',detail:`${range.toUpperCase()} / ${trades?`${t.symbol} ${t.leverage}× ${t.side.toUpperCase()}`:type==='stakers'?'HOUSE STAKED':'REALIZED PNL'} / LEADERBOARD`}});
  };
  const summary=data?.summary;
  const emptyText=status==='loading'?'Loading leaderboard…':needle?'No matching traders.':trades?(type==='liquidated'?'No liquidated positions in this period.':'No closed positions in this period.'):category.empty||'No trades in this period yet.';
  const columns=trades?11:type==='stakers'?8:10;

  return <Shell dashboard="leaderboard" title="Leaderboard"><section className="jt-panel pm-ranking-board ds-ranking" aria-label="Leaderboard standings">
    <div className="ds-ranking-toolbar">
      <div className="ds-view-switch" role="group" aria-label="Leaderboard view"><button aria-pressed={view==='accounts'} onClick={()=>{setView('accounts');reset();}}>Accounts</button><button aria-pressed={view==='positions'} disabled={type==='stakers'} onClick={()=>{setView('positions');reset();}}>Positions</button></div>
      <FilterSelect label="Ranking category" value={type} onChange={chooseType} items={[["winners","Top traders"],["liquidated","Liquidated"],["stakers","House owners"]]}/>
      {type!=='stakers'&&<FilterSelect label="Ranking period" value={period} onChange={v=>{setPeriod(v);reset();}} items={[["1d","24H"],["7d","7D"],["30d","30D"],["all","All"]]}/>}
      <input className="pm-search" aria-label="Search traders" placeholder={trades?"Search name or asset":"Search name or address"} maxLength={42} value={search} onChange={e=>setSearch(e.target.value)}/>
      <button className="luna-btn ds-claim-name" onClick={()=>setModal({type:'username'})}>Claim username ↗</button>
    </div>
    {status==='error'?<div className="pm-empty" role="alert">The leaderboard could not be loaded. {error} <button className="luna-btn" onClick={()=>setAttempt(attempt+1)}>Retry</button></div>:<>
    <div className="pm-table-scroll"><table className="pm-table ds-ranking-table"><thead><tr>{heading('#','rank')}{heading('User','user')}
      {trades?<><th>Asset</th>{heading('Notional','notional')}<th>Entry → exit</th>{heading('PnL','pnl')}{heading('Return','roi')}{heading('Margin','margin')}{heading('Duration','duration')}{heading('Closed','closedAt')}</>
      :type==='stakers'?<>{heading('HOUSE staked','staked')}{heading('Staking rewards','stakingRewards')}{heading('HOUSE earned','minted')}{heading('Trades','trades')}{heading('Last active','lastActive')}</>
      :<>{heading('Volume','volume')}{heading('PnL','pnl')}{heading('Return','roi')}{heading('Trades','trades')}{heading('Win rate','winRate')}{type==='liquidated'?heading('Liquidations','liquidations'):<th>Margin</th>}</>}
      <th>Details</th></tr></thead>
    <tbody>{status==='ready'&&rows.map((t,i)=>{const rank=rankOf(t,i),link=profileLink(t);return <Fragment key={t.id}>
      <tr className={typeof rank==='number'&&rank<=3?`ds-rank-${rank}`:undefined} tabIndex={0} onClick={e=>{if(!e.target.closest("a,button"))setExpanded(expanded===t.id?null:t.id);}} onKeyDown={e=>{if(e.target===e.currentTarget&&["Enter"," "].includes(e.key)){e.preventDefault();setExpanded(expanded===t.id?null:t.id);}}}><td><span className="ds-rank-medal">{rank}</span></td><td><Link to={link.to} params={link.params}><strong>{t.name}</strong></Link>{t.user===me&&<small> YOU</small>}</td>
        {trades?<><td><span className="ds-asset-cell"><MarketIcon market={marketBySymbol(`${t.symbol}-PERP`)??{symbol:t.symbol,glyph:t.symbol[0]}} size={16}/><strong>{t.symbol}</strong></span> <small className={t.side==='long'?'pm-up':'pm-down'}>{t.leverage}× {t.side.toUpperCase()}</small></td><td>${compact(t.notional)}</td><td>{money(t.entry)} <span className="ds-arrow">→</span> {money(t.exit)}</td>
          <td className={toneOf(t.pnl)}><strong>{signed(t.pnl)}</strong>{t.liquidated&&<small className="pm-down">LIQUIDATED</small>}</td><td className={toneOf(t.roi)}>{pct(t.roi)}</td><td>${money(t.margin)}</td><td>{duration(t.duration)}</td><td>{ago(t.closedAt)}</td></>
        :type==='stakers'?<><td><strong>{compact(t.staked)}</strong></td><td>${money(t.stakingRewards)}</td><td>{compact(t.minted)}</td><td>{t.trades}</td><td>{ago(t.lastActive)}</td></>
        :<><td>${compact(t.volume)}</td><td className={toneOf(t.pnl)}><strong>{signed(t.pnl)}</strong></td><td className={toneOf(t.roi)}>{pct(t.roi)}</td><td>{t.trades}</td><td>{t.winRate==null?'–':t.winRate.toFixed(0)+'%'}</td><td>{type==='liquidated'?t.liquidations:'$'+money(t.margin)}</td></>}
        <td><button className="ds-detail-button" aria-label={`Details for ${t.name}${trades?' '+t.symbol+' '+t.leverage+'x':''}`} aria-expanded={expanded===t.id} onClick={()=>setExpanded(expanded===t.id?null:t.id)}>{expanded===t.id?'−':'+'}</button></td>
      </tr>
      {expanded===t.id&&<tr className="ds-expanded-row"><td colSpan={columns}><div className="ds-rank-detail"><StatRows rows={trades
        ?[["Market",t.market],["Direction",t.side.toUpperCase()],["Leverage",t.leverage+'×'],["Margin",'$'+money(t.margin)],["Entry",'$'+money(t.entry)],["Exit",'$'+money(t.exit)],["Notional",'$'+money(t.notional)],["PnL",signed(t.pnl),t.pnl>=0?'up':'down'],["Return on margin",pct(t.roi),t.roi>=0?'up':'down'],["Duration",duration(t.duration)],["Opened",new Date(t.openedAt*1000).toLocaleString()],["Closed",new Date(t.closedAt*1000).toLocaleString()],["Outcome",t.liquidated?'Liquidated':'Closed']]
        :[["Account",shortAddress(t.user)],["Rank by PnL",t.rank??'–'],["Closed trades",t.trades],["Wins",t.wins],["Liquidations",t.liquidations],["Closed margin",'$'+money(t.margin)],["Realized PnL (all time)",signed(t.realizedPnl),t.realizedPnl>=0?'up':'down'],["Unrealized PnL (est.)",signed(t.unrealizedPnl),t.unrealizedPnl==null?undefined:t.unrealizedPnl>=0?'up':'down'],["Open notional",'$'+money(t.openNotional)],["Queued",'$'+money(t.queued)],["HOUSE staked",compact(t.staked)],["Staking rewards",'$'+money(t.stakingRewards)],["HOUSE earned",compact(t.minted)],["Last active",t.lastActive?new Date(t.lastActive*1000).toLocaleString():'–']]}/>
        <div><Link className="luna-btn" to={link.to} params={link.params}>View portfolio ↗</Link><button className="luna-btn" onClick={()=>share(t)}>Share ↗</button></div></div></td></tr>}
    </Fragment>;})}</tbody></table>{(status!=='ready'||!rows.length)&&<div className="pm-empty">{emptyText}</div>}</div>
    <div className="ds-pagination">
      <span>{trades?`${rows.length} positions · top 15 by PnL`:summary?`${plural(type==='winners'?data.count:accounts.length+page*PAGE_SIZE,'account',more&&type!=='winners')} · ${plural(summary.trades,'closed trade')} · $${compact(Number(summary.volume))} volume`:'–'}</span>
      {!trades&&<><button disabled={!page||status==='loading'} onClick={()=>{setPage(page-1);setExpanded(null);}}>← Previous</button><span>{page+1} / {totalPages}</span><button disabled={!more||status==='loading'} onClick={()=>{setPage(page+1);setExpanded(null);}}>Next →</button></>}
    </div></>}
  </section></Shell>;
}
