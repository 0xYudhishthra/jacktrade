import test from 'node:test';
import assert from 'node:assert/strict';
import {API_WINDOW,isAddress,pnlChartSeries,shortAddress,tradeSummary} from '../src/lib/dashboardData.js';

// Shapes copied from GET /api/pnl/:user and GET /api/history/:user on the local fork indexer.
const pnl={user:'0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',window:'all',start:{realizedPnl:'0',netDeposits:'0',equity:'0'},points:[
  {at:1000,type:'deposit',delta:'1000',realizedPnl:'0',netDeposits:'1000',equity:'1000'},
  {at:2000,type:'close',delta:'0.061029',positionId:'6',market:'BTC/USD',realizedPnl:'0.061029',netDeposits:'1000',equity:'1000.061029'},
  {at:3000,type:'liquidation',delta:'-10',positionId:'4',market:'BTC/USD',realizedPnl:'-9.938971',netDeposits:'1000',equity:'990.061029'},
]};
test('pnl series follows the API points and is carried to now',()=>{
  const equity=pnlChartSeries(pnl,'equity',5_000_000);
  assert.deepEqual(equity.map(p=>p.t),[1_000_000,2_000_000,3_000_000,5_000_000]);
  assert.equal(equity.at(-1).p,990.061029);
  assert.equal(pnlChartSeries(pnl,'realizedPnl',5_000_000)[1].p,0.061029);
});
test('a windowed series opens at the start values; an account with nothing is empty',()=>{
  const now=10*864e5;
  const quiet={window:'24h',start:{realizedPnl:'5',netDeposits:'100',equity:'105'},points:[]};
  assert.deepEqual(pnlChartSeries(quiet,'equity',now),[{t:now-864e5,p:105},{t:now,p:105}]);
  assert.deepEqual(pnlChartSeries({window:'7d',start:{realizedPnl:'0',netDeposits:'0',equity:'0'},points:[]},'equity',now),[]);
  assert.deepEqual(pnlChartSeries({window:'all',start:{equity:'0'},points:[]},'equity',now),[]);
  assert.deepEqual(pnlChartSeries(null),[]);
  assert.equal(API_WINDOW['1d'],'24h');
});
test('trade summary uses only closed trades from the history',()=>{
  const items=[
    {type:'liquidation',id:'4',margin:'10',leverage:1000,pnl:'-10',at:3},
    {type:'deposit',amount:'1000',at:2},
    {type:'close',id:'6',margin:'20',leverage:100,pnl:'0.061029',at:1},
    {type:'close',id:'7',margin:'20',leverage:100,pnl:'-0.204581',at:1},
  ];
  const s=tradeSummary(items,2);
  assert.equal(s.trades,3);
  assert.equal(s.wins,1);
  assert.equal(s.liquidations,1);
  assert.equal(s.avgLeverage,400);
  assert.ok(Math.abs(s.realized-(-10.143552))<1e-9);
  assert.deepEqual(s.best.map(t=>t.id),['6','7']);
  assert.equal(tradeSummary([]).avgLeverage,null);
});
test('address detection for /u/:name',()=>{
  assert.ok(isAddress('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc'));
  assert.ok(!isAddress('trader.loyaj'));
  assert.ok(!isAddress('0x3c44'));
  assert.equal(shortAddress('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc'),'0x3c44…93bc');
});
