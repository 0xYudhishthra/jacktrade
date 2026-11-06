import test from 'node:test';
import assert from 'node:assert/strict';
import {mapActivity,mapActivityPage,describeActivity} from '../src/lib/accountActivity.js';
const item=(over)=>({id:'0xa-1',kind:'stake',user:'0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',username:null,market:null,side:null,amount:'600',unit:'JACKTRADE',at:1793072000,tx:'0xa',...over});
test('backend activity maps to dashboard rows with real units and times',()=>{
  const row=mapActivity(item());
  assert.deepEqual([row.type,row.unit,row.amount,row.time],['STAKE','HOUSE',600,1793072000000]);
  assert.equal(mapActivity(item({kind:'mint',amount:'1000'})).type,'LOSS MINT');
  assert.equal(mapActivity(item({kind:'queuePaid',unit:'USDG',amount:'0.061029'})).type,'QUEUE PAID');
  const page=mapActivityPage({items:[item(),item({id:'0xb-2',kind:'claim',unit:'USDG',amount:'5'})],next:'98940178000002'});
  assert.equal(page.rows.length,2);
  assert.equal(page.next,'98940178000002');
  assert.deepEqual(mapActivityPage({items:[],next:null}),{rows:[],next:null});
});
test('global feed lines name the trader and keep losses signed',()=>{
  assert.equal(describeActivity(mapActivity(item({username:'trader.loyaj',kind:'close',market:'BTC/USD',side:'long',amount:'-0.204581',unit:'USDG'}))),'trader.loyaj closed BTC/USD · PnL −0.2 USDG');
  assert.equal(describeActivity(mapActivity(item({kind:'deposit',amount:'20',unit:'USDG'}))),'0x3c44…93bc deposited 20 USDG');
  assert.equal(describeActivity(mapActivity(item({kind:'distribution',user:null,amount:'12.5',unit:'USDG'}))),'12.5 USDG distributed to stakers');
});
