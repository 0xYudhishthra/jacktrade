// Chart shapes for the network dashboards, built only from indexer responses (GET /api/token, /api/token/history,
// /api/stats/history, /api/house). Times come in Unix seconds and leave in ms; amounts are decimal strings.
const n=v=>Number(v??0)||0;

// A value per bucket, as the API sends it ({ t, [key] }).
export const pointSeries=(points=[],key)=>points.map(p=>({t:p.t*1000,p:n(p[key])}));

// Per-bucket sums (minted, distributed) as a running total that ends at `total` (the all-time figure now), so a
// 7d or 30d window still shows the real level instead of starting at zero.
export function cumulativeSeries(points=[],key,total){
  const windowSum=points.reduce((s,p)=>s+n(p[key]),0);
  let running=Math.max(0,(total==null?windowSum:n(total))-windowSum);
  return points.map(p=>{running+=n(p[key]);return {t:p.t*1000,p:running};});
}

// Sum of `key` over buckets that start at or after `since` (Unix seconds).
export const sumSince=(points=[],key,since)=>points.reduce((s,p)=>p.t>=since?s+n(p[key]):s,0);

// Share of the staking pool (0..1); null when nothing is staked.
export function stakeShare(staked,totalStaked){
  const total=n(totalStaked);
  return total>0?Math.min(1,n(staked)/total):null;
}

// What `staked` HOUSE would have earned from the real distributions of the last `days` days. null when nothing was
// distributed in that period (there is no basis for an estimate). Adding `extra` tokens grows the pool too.
export function rewardEstimate({points=[],days=30,now=Date.now(),staked=0,totalStaked=0,extra=0}){
  const distributed=sumSince(points,'distributed',Math.floor(now/1000)-days*86400);
  const pool=n(totalStaked)+n(extra),mine=n(staked)+n(extra);
  if(distributed<=0)return null;
  const share=pool>0?mine/pool:0;
  return {distributed,share,perDay:distributed*share/days,perMonth:distributed*share/days*30};
}

// House PnL for each price move, with the 0 % point (nothing moves, nothing changes).
export function shockSeries(shocks=[]){
  const rows=shocks.map(s=>({t:n(s.move),p:n(s.houseDelta)}));
  if(rows.length&&!rows.some(r=>r.t===0))rows.push({t:0,p:0});
  return rows.sort((a,b)=>a.t-b.t);
}

// Liquidation map bins as chart bands: opacity follows the notional that would be liquidated in that price range.
export function liquidationBands(bins=[],{long='#2d9562',short='#254a87'}={}){
  const max=Math.max(0,...bins.map(b=>n(b.longNotional)+n(b.shortNotional)));
  if(!max)return [];
  return bins.filter(b=>n(b.longNotional)+n(b.shortNotional)>0).map(b=>{
    const total=n(b.longNotional)+n(b.shortNotional);
    return {low:n(b.from),high:n(b.to),opacity:.08+.4*total/max,color:n(b.longNotional)>=n(b.shortNotional)?long:short,longNotional:n(b.longNotional),shortNotional:n(b.shortNotional),positions:b.positions||0};
  });
}
