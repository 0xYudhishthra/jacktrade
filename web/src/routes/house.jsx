import { useState } from 'react';
import { useTradingSession } from '@/hooks/useTradingSession';
import { usePolledData } from '@/hooks/useBackendAccount';
import { Shell, Panel, Hint, FilterSelect } from '@/components/product/ProductUI';
import DashboardChart, { StatRows } from '@/components/product/DashboardChart';
import { money, compact } from '@/lib/protocolModel';
import { ChartTools, SnapshotChart, DataError } from '@/components/product/DashboardTools';
import { fetchActivity, fetchHouse, fetchStats, fetchStatsHistory, fetchToken } from '@/lib/jacktradeApi';
import { fetchCandles } from '@/lib/pricesApi';
import { describeActivity, mapActivityPage } from '@/lib/accountActivity';
import { liquidationBands, pointSeries, shockSeries } from '@/lib/dashboardNetwork';
import { usdShort } from '@/lib/dashboardData';
import MarketIcon from '@/components/product/MarketIcon';
import { getMarkets, marketBySymbol } from '@/lib/mockMarkets';
import { PageHead } from '@/components/grok/GrokUI';
const RANGES=[['24h','24H'],['7d','7D'],['30d','30D']];
const asset=name=>String(name||'').split('/')[0];
const dateLabel=t=>new Date(t).toLocaleDateString('en-US',{month:'short',day:'numeric'});
const rangeFormat=range=>range==='24h'?undefined:dateLabel;
// Stats history for one chart's range (each chart keeps its own range).
const useStatsHistory=range=>usePolledData(`stats-history:${range}`,()=>fetchStatsHistory(range),30_000);
export default function House() {
  const {account} = useTradingSession();
  const [market,setMarket]=useState('BTC');
  const [fundMetric,setFundMetric]=useState('housePnl');
  const [spread,setSpread]=useState('10');
  const [heatMarket,setHeatMarket]=useState('BTC'),[pnlMarket,setPnlMarket]=useState('BTC');
  const [heatTf,setHeatTf]=useState('15m');
  const [fundRange,setFundRange]=useState('24h'),[exposureRange,setExposureRange]=useState('24h'),[queueRange,setQueueRange]=useState('24h');
  const [fundPaused,setFundPaused]=useState(false),[exposurePaused,setExposurePaused]=useState(false),[queuePaused,setQueuePaused]=useState(false);
  const [scope,setScope]=useState('network');
  const houseFeed=usePolledData('house',fetchHouse,10_000);
  const statsFeed=usePolledData('stats',fetchStats,10_000);
  const tokenFeed=usePolledData('token',fetchToken,30_000);
  const activityFeed=usePolledData('house-activity',()=>fetchActivity({limit:30}).then(mapActivityPage),10_000);
  const fundHistory=useStatsHistory(fundRange),exposureHistory=useStatsHistory(exposureRange),queueHistory=useStatsHistory(queueRange);
  const candleFeed=usePolledData(`candles:${heatMarket}:${heatTf}`,()=>fetchCandles(`${heatMarket}-PERP`,heatTf),30_000);
  const house=houseFeed.data,stats=statsFeed.data,token=tokenFeed.data;
  const markets=house?.markets??[];
  // Listed markets from the indexer, then the equities not listed yet (preview): priced, charted, not tradable.
  const listed=markets.length?markets.map(m=>asset(m.name)):['BTC','ETH'];
  const names=[...listed,...getMarkets().map(m=>asset(m.symbol.replace('-PERP',''))).filter(m=>!listed.includes(m))];
  const preview=m=>!listed.includes(m);
  const marketItems=names.map(m=>{const info=marketBySymbol(`${m}-PERP`);return [m,m,info&&<MarketIcon market={info} size={16}/>,preview(m)?'Preview':undefined];});
  const previewNote=m=>`${m} is preview-only: it can't be traded yet, so it has no positions.`;
  const byName=m=>markets.find(item=>asset(item.name)===m);
  const network=scope==='network';
  const mine=m=>{const positions=account.positions.filter(p=>p.symbol===`${m}-PERP`);return [positions.filter(p=>p.side==='long').reduce((s,p)=>s+p.notional,0),positions.filter(p=>p.side==='short').reduce((s,p)=>s+p.notional,0)];};
  const oi=m=>network?[Number(byName(m)?.longOi??0),Number(byName(m)?.shortOi??0)]:mine(m);
  const totals=names.reduce((sum,m)=>{const [l,s]=oi(m);return [sum[0]+l,sum[1]+s];},[0,0]);
  const free=Number(stats?.bankroll??house?.bankroll??0);
  const debt=Number(stats?.queue.total??house?.queue??0);
  const housePnL=Number(stats?.housePnl??house?.housePnl??0);
  const unavailable=(feed,what)=>feed.error&&!feed.data?<DataError what={what} error={feed.error} onRetry={feed.retry}/>:null;
  const exposurePoints=exposureHistory.data?.markets.find(m=>asset(m.name)===market)?.points??[];
  const heat=byName(heatMarket),candles=(candleFeed.data??[]).map(c=>({...c,p:c.c})),price=Number(heat?.price??0)||Number(candles.at(-1)?.c??0);
  const bands=liquidationBands(heat?.liquidationMap);
  const pnlInfo=byName(pnlMarket);
  const placement=account.queue[0];
  const marketControl=<FilterSelect label="House analysis market" value={market} onChange={setMarket} items={marketItems}/>;
  const openInterest=totals[0]+totals[1];
  return <Shell dashboard="house" title="House"><div className="jt-page jt-page-wide jt-dash">
    <PageHead title="The House">The house takes the other side of every trade. Here's how it's doing, live.</PageHead>
    <div className="jt-stats jt-stats-4">
      <div className="jt-stat is-lead"><span>Free house funds</span><strong>{stats||house?'$'+money(free):'…'}</strong></div>
      <div className="jt-stat"><span>House PnL</span><strong className={housePnL>=0?'is-up':'is-down'}>{stats||house?`${housePnL>=0?'+':'−'}$${money(Math.abs(housePnL))}`:'…'}</strong></div>
      <div className="jt-stat"><span>Waiting in the payout queue</span><strong>{stats||house?'$'+money(debt):'…'}</strong></div>
      <div className="jt-stat"><span>Open interest</span><strong>{'$'+compact(openInterest)}</strong></div>
    </div>

    {/* Each row: a wide panel and a narrow one, the same height. */}
    <div className="jt-row">
      <Panel title="House funds" className="ds-plot-panel" aside={<ChartTools label="House funds range" range={fundRange} onRange={setFundRange} ranges={RANGES} paused={fundPaused} onPause={setFundPaused}><FilterSelect label="House funds metric" value={fundMetric} onChange={setFundMetric} items={[["housePnl","House PnL"],["queue","Queue debt"]]}/></ChartTools>}>
        {unavailable(fundHistory,'house history')||<SnapshotChart paused={fundPaused} zero xFormat={rangeFormat(fundRange)} empty={fundHistory.loading?'Loading…':'No house activity yet.'} label={fundMetric==='housePnl'?'House PnL over time':'Queue debt over time'} height={230} series={fundHistory.data?[{name:fundMetric==='housePnl'?'House PnL':'Queue debt',data:pointSeries(fundHistory.data.points,fundMetric),fill:true}]:[]}/>}
      </Panel>
      <Panel title="House stats" aside={<Hint text="Live protocol totals from the JackTrade indexer."/>} className="ds-stats-panel">
        {stats?<StatRows rows={[["Deposits",'$'+money(Number(stats.deposits))],["Withdrawals",'$'+money(Number(stats.withdrawals))],["Fees",'$'+money(Number(stats.fees))],["Network volume",'$'+compact(Number(stats.volume))],["Open positions",stats.open],["Queue entries",stats.queue.entries??'—']]}/>
          :unavailable(statsFeed,'house stats')||<div className="pm-empty">Loading…</div>}
      </Panel>
    </div>

    <div className="jt-row">
      <Panel title="Market exposure" className="ds-plot-panel" aside={<ChartTools label="Exposure range" range={exposureRange} onRange={setExposureRange} ranges={RANGES} paused={exposurePaused} onPause={setExposurePaused}>{marketControl}</ChartTools>}>
        {unavailable(exposureHistory,'exposure history')||<SnapshotChart paused={exposurePaused} xFormat={rangeFormat(exposureRange)} empty={exposureHistory.loading?'Loading…':preview(market)?previewNote(market):'No open interest yet.'} label={`${market} long and short open interest`} height={230} series={exposurePoints.length?[
          {name:`${market} long`,color:'#3fd68a',data:pointSeries(exposurePoints,'longOi')},
          {name:`${market} short`,color:'#ec3d55',data:pointSeries(exposurePoints,'shortOi')},
        ]:[]}/>}
      </Panel>
      <Panel title={network?"Open positions":"Your positions"} aside={<FilterSelect label="Positions scope" value={scope} onChange={setScope} items={[["network","All users"],["account","Your account"]]}/>}>
        <StatRows rows={[["Open interest",'$'+compact(totals[0]+totals[1])],["Open margin",'$'+money(network?Number(house?.margin??0):account.usedMargin)],["Positions",network?(house?.positions??'—'):account.positions.length]]}/>
        <table className="ds-mini-table"><thead><tr><th>Asset</th><th>Long</th><th>Short</th><th>Net</th></tr></thead><tbody>
          {names.map(m=>{const [long,short]=oi(m);const info=marketBySymbol(`${m}-PERP`);return <tr key={m}><td><span className="ds-asset-cell">{info&&<MarketIcon market={info} size={14}/>}{m}</span></td><td>{usdShort(long)}</td><td>{usdShort(short)}</td><td>{usdShort(long-short)}</td></tr>;})}
        <tr><td>Total</td><td>{usdShort(totals[0])}</td><td>{usdShort(totals[1])}</td><td>{usdShort(totals[0]-totals[1])}</td></tr></tbody></table>
        {network&&unavailable(houseFeed,'house exposure')}
      </Panel>
    </div>

    <div className="jt-row">
      <Panel title="Liquidation heatmap" className="ds-plot-panel ds-heatmap-panel" aside={<div className="ds-chart-controls"><FilterSelect label="Heatmap market" value={heatMarket} onChange={setHeatMarket} items={marketItems}/><FilterSelect label="Heatmap timeframe" value={heatTf} onChange={setHeatTf} items={[["5m","5m"],["15m","15m"],["1h","1h"]]}/><FilterSelect label="Heatmap range" value={spread} onChange={setSpread} items={[["10","±10%"],["25","±25%"],["50","±50%"]]}/><Hint text="Open-position notional that would be liquidated in each price band, over real price candles."/></div>}>
        <div className="ds-heat-legend"><span>$0</span><i/><span>High concentration</span></div>
        {unavailable(houseFeed,'liquidation map')||<DashboardChart label={`${heatMarket} liquidation price bands with candles`} height={360} watermark format={v=>'$'+money(v,0)} empty={candleFeed.error?`Couldn't load prices: ${candleFeed.error}`:'Loading…'} domain={price?[price*(1-Number(spread)/100),price*(1+Number(spread)/100)]:undefined} bands={bands} markers={price?[{value:price,label:'$'+money(price,0)}]:[]} series={candles.length?[{name:`${heatMarket} price`,data:candles,candles:true}]:[]}/>}
        {!bands.length&&!houseFeed.loading&&<p className="jt-chart-note">{preview(heatMarket)?previewNote(heatMarket):`No open ${heatMarket} positions to liquidate.`}</p>}
      </Panel>
      <div className="jt-stack">
        <Panel title="If the price moves" className="ds-plot-panel" aside={<div className="ds-chart-controls"><Hint text="What the house would gain or lose on open positions if the price moved by this much now."/><FilterSelect label="PnL scenario market" value={pnlMarket} onChange={setPnlMarket} items={marketItems}/></div>}>
          {unavailable(houseFeed,'house exposure')||<DashboardChart label={`House PnL for ${pnlMarket} price moves from minus ten to plus ten percent`} height={150} zero xFormat={v=>`${v.toFixed(1)}%`} empty={houseFeed.loading?'Loading…':preview(pnlMarket)?previewNote(pnlMarket):'No open positions.'} series={pnlInfo?.shocks?.length?[{name:'House PnL',data:shockSeries(pnlInfo.shocks),fill:true}]:[]}/>}
        </Panel>
        <Panel title="Leverage mix" aside={<span className="ds-source-tag"><MarketIcon market={marketBySymbol(`${pnlMarket}-PERP`)??{symbol:pnlMarket}} size={14}/>{pnlMarket}</span>}>
          {pnlInfo?.positions?<table className="ds-mini-table"><thead><tr><th>Leverage</th><th>Positions</th><th>Long</th><th>Short</th></tr></thead><tbody>
            {pnlInfo.leverage.filter(b=>b.positions>0).map(b=><tr key={b.min}><td>{b.max==null?`${b.min}×+`:`${b.min}–${b.max}×`}</td><td>{b.positions}</td><td>{usdShort(Number(b.longNotional))}</td><td>{usdShort(Number(b.shortNotional))}</td></tr>)}
          </tbody></table>:<div className="pm-empty">{houseFeed.loading?'Loading…':preview(pnlMarket)?previewNote(pnlMarket):`No open ${pnlMarket} positions.`}</div>}
        </Panel>
      </div>
    </div>

    <div className="jt-row">
      <Panel title="Payout queue" className="ds-plot-panel" aside={<ChartTools label="Queue debt range" range={queueRange} onRange={setQueueRange} ranges={RANGES} paused={queuePaused} onPause={setQueuePaused}/>}>{unavailable(queueHistory,'queue history')||<SnapshotChart paused={queuePaused} xFormat={rangeFormat(queueRange)} empty={queueHistory.loading?'Loading…':'No queued profit yet.'} label="Queued profit across all users" height={200} series={queueHistory.data?[{name:'Queue debt',data:pointSeries(queueHistory.data.points,'queue'),fill:true}]:[]}/>}</Panel>
      <Panel title="Your place in line" aside={<Hint text="Only profit can queue, never remaining margin. FIFO payments are funded by future losses; there is no guaranteed payment time."/>}>
        <div className="jt-queue">
          <div className="ds-queue-ring" style={{'--queue-fill':placement?'var(--theme-text)':'var(--theme-line)'}}><div><strong>{placement?`#${placement.position}`:debt>0?`${stats?.queue.entries??0}`:'0'}</strong><span>{placement?'your place':debt>0?'waiting':'in line'}</span></div></div>
          <StatRows rows={[["Queue debt",'$'+money(debt)],["Payouts ever queued",house?.queuedPayouts??'—'],["Ahead of you",placement?'$'+money(placement.ahead):'—'],["You're owed",placement?usdShort(placement.amount):'—']]}/>
        </div>
      </Panel>
    </div>

    {account.queue.length>0 && <Panel title="Your payment queue"><div className="pm-table-scroll"><table className="pm-table"><thead><tr><th>Place in line</th><th>Queued profit</th><th>Ahead of you</th><th>Payment rule</th></tr></thead><tbody>{account.queue.map(q=><tr key={q.id}><td>#{q.position}</td><td>${money(q.amount)}</td><td>${money(q.ahead)}</td><td>FIFO · margin is not queued</td></tr>)}</tbody></table></div></Panel>}

    <div className="jt-row">
      <Panel title="House activity" className="jt-activity">{unavailable(activityFeed,'activity')||(activityFeed.data?.rows.length?activityFeed.data.rows.map(e=><div className="pm-event" key={e.id}><time>{new Date(e.time).toLocaleTimeString()}</time><span>{describeActivity(e)}</span></div>):<div className="pm-empty">{activityFeed.loading?'Loading…':'No settlements yet.'}</div>)}</Panel>
      <div className="jt-stack">
        <Panel title="HOUSE token">
          <StatRows rows={network?[["Supply",token?compact(Number(token.token.totalSupply)):'—'],["Staked",token?compact(Number(token.staking.totalStaked)):'—'],["Staker rewards",token?'$'+money(Number(token.rewards.distributed),2):'—'],["Paid in","USDG"]]:[["Minted by you",compact(account.minted)],["Your stake",compact(account.staked)],["Your rewards",'$'+money(account.claimed+account.claimable,2)],["Paid in","USDG"]]}/>
          {network&&unavailable(tokenFeed,'token data')}
        </Panel>
        <Panel title="How the money moves">
          <ol className="jt-flow">
            <li><b>Trader losses</b> go to the house pool.</li>
            <li><b>Winning trades</b> are paid from that pool, in order.</li>
            <li><b>Losses mint HOUSE</b>, which stakers lock to earn USDG.</li>
          </ol>
        </Panel>
      </div>
    </div>
  </div></Shell>;
}
