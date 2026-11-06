// Backend activity (GET /api/activity) in the dashboard's row shape: { id, time (ms), type, amount, unit, market }.
const LABELS={open:'OPEN',close:'CLOSE',liquidation:'LIQUIDATION',deposit:'DEPOSIT',withdraw:'WITHDRAW',queued:'QUEUED',queuePaid:'QUEUE PAID',stake:'STAKE',unstake:'UNSTAKE',claim:'CLAIM',mint:'LOSS MINT',distribution:'DISTRIBUTION'};
export const activityLabel=kind=>LABELS[kind]||String(kind||'').toUpperCase();
export function mapActivity(item){
  return {
    id:item.id,kind:item.kind,type:activityLabel(item.kind),time:Number(item.at)*1000,
    amount:Number(item.amount??0),unit:/money$/i.test(item.unit??'')?'HOUSE':item.unit,
    market:item.market||undefined,side:item.side||undefined,user:item.user,username:item.username,tx:item.tx,
  };
}
export const mapActivityPage=page=>({rows:(page?.items||[]).map(mapActivity),next:page?.next??null});
// One-line description for the global feed.
export function describeActivity(row){
  const amount=`${Math.abs(row.amount).toLocaleString('en-US',{maximumFractionDigits:row.unit==='USDG'?2:4})} ${row.unit}`;
  const who=row.username||(row.user?`${row.user.slice(0,6)}…${row.user.slice(-4)}`:'');
  const what={OPEN:`opened ${row.side||''} ${row.market||''} with ${amount} margin`,CLOSE:`closed ${row.market||''} · PnL ${row.amount<0?'−':''}${amount}`,LIQUIDATION:`was liquidated on ${row.market||''} · lost ${amount}`,DEPOSIT:`deposited ${amount}`,WITHDRAW:`withdrew ${amount}`,QUEUED:`queued ${amount} of profit`,'QUEUE PAID':`was paid ${amount} from the queue`,STAKE:`staked ${amount}`,UNSTAKE:`unstaked ${amount}`,CLAIM:`claimed ${amount}`,'LOSS MINT':`received ${amount} from a loss`,DISTRIBUTION:`${amount} distributed to stakers`}[row.type]||`${row.type.toLowerCase()} ${amount}`;
  return (row.type==='DISTRIBUTION'||!who?what:`${who} ${what}`).replace(/\s+/g,' ').trim();
}
