import test from 'node:test';
import assert from 'node:assert/strict';
import {cumulativeSeries,pointSeries,sumSince,stakeShare,rewardEstimate,shockSeries,liquidationBands} from '../src/lib/dashboardNetwork.js';
const day=86400,now=40*day*1000;
const points=[{t:20*day,distributed:'10',minted:'0',totalStaked:'100'},{t:35*day,distributed:'0',minted:'5',totalStaked:'100'},{t:39*day,distributed:'20',minted:'15',totalStaked:'300'}];
test('network series come from API buckets and running totals end at the live figure',()=>{
  assert.deepEqual(pointSeries(points,'totalStaked').map(p=>p.p),[100,100,300]);
  assert.equal(pointSeries(points,'totalStaked')[0].t,20*day*1000);
  assert.deepEqual(cumulativeSeries(points,'minted','1020').map(p=>p.p),[1000,1005,1020]);
  assert.deepEqual(cumulativeSeries(points,'distributed').map(p=>p.p),[10,10,30]);
  assert.deepEqual(cumulativeSeries([],'minted','0'),[]);
  assert.equal(sumSince(points,'distributed',33*day),20);
});
test('stake share and reward estimates use real stake and real distributions only',()=>{
  assert.equal(stakeShare(50,'200'),.25);
  assert.equal(stakeShare(50,'0'),null);
  const month=rewardEstimate({points,days:30,now,staked:75,totalStaked:300});
  assert.equal(month.distributed,30);
  assert.equal(month.share,.25);
  assert.equal(month.perMonth,7.5);
  assert.equal(rewardEstimate({points,days:7,now,staked:75,totalStaked:300}).distributed,20);
  assert.equal(rewardEstimate({points:points.map(p=>({...p,distributed:'0'})),days:30,now,staked:75,totalStaked:300}),null);
  assert.equal(rewardEstimate({points,days:30,now,totalStaked:100,extra:100}).share,.5);
});
test('house shocks and the liquidation map become chart data without invented values',()=>{
  assert.deepEqual(shockSeries([{move:-1,houseDelta:'-190.6'},{move:1,houseDelta:'26.5'}]).map(p=>[p.t,p.p]),[[-1,-190.6],[0,0],[1,26.5]]);
  assert.deepEqual(shockSeries([]),[]);
  const bins=[{from:'90',to:'95',longNotional:'1000',shortNotional:'0',positions:1},{from:'95',to:'100',longNotional:'0',shortNotional:'0',positions:0},{from:'105',to:'110',longNotional:'0',shortNotional:'4000',positions:2}];
  const bands=liquidationBands(bins);
  assert.equal(bands.length,2);
  assert.deepEqual([bands[0].low,bands[0].high,bands[0].color],[90,95,'#2d9562']);
  assert.ok(bands[1].opacity>bands[0].opacity);
  assert.deepEqual(liquidationBands(bins.map(b=>({...b,longNotional:'0',shortNotional:'0'}))),[]);
});
