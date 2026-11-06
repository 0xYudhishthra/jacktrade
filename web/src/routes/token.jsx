import { useState } from "react";
import { useTradingSession } from "@/hooks/useTradingSession";
import { usePolledData } from "@/hooks/useBackendAccount";
import {
  Shell,
  Panel,

  FilterSelect,
  Hint,
  useProductUI,
} from "@/components/product/ProductUI";
import { StatRows } from "@/components/product/DashboardChart";
import { ChartTools, SnapshotChart, ActivityTable, DataError } from "@/components/product/DashboardTools";
import { mapActivityPage } from "@/lib/accountActivity";
import { cumulativeSeries, pointSeries, rewardEstimate, stakeShare } from "@/lib/dashboardNetwork";
import { fetchActivity, fetchToken, fetchTokenHistory } from "@/lib/jacktradeApi";
import { API_URL, requestJson } from "@/lib/backend";
import { money, compact, rewardUsd } from "@/lib/protocolModel";
const REVENUE_INTERVAL = { "24h": "1h", "7d": "4h", "30d": "1d" };
const short = (address) => address ? `${address.slice(0,6)}…${address.slice(-4)}` : "Loading…";
const percent = (share) => share == null ? "—" : (share*100).toFixed(share && share < .0001 ? 6 : 2)+"%";
export default function Token() {
  const { account, walletConnected } = useTradingSession();
  const { notify, setModal } = useProductUI();
  const [loss, setLoss] = useState("100");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("stake");
  const [error, setError] = useState("");
  const dateLabel=t=>new Date(t).toLocaleDateString("en-US",{month:"short",day:"numeric"});
  const [revenueRange,setRevenueRange]=useState('24h'),[supplyRange,setSupplyRange]=useState('all'),[rewardsRange,setRewardsRange]=useState('all');
  const [revenuePaused,setRevenuePaused]=useState(false),[supplyPaused,setSupplyPaused]=useState(false),[rewardsPaused,setRewardsPaused]=useState(false);
  const user = account.protocol?.wallet;
  const tokenFeed = usePolledData("token", fetchToken, 15_000);
  const rateFeed = usePolledData("rate", () => requestJson(`${API_URL}/api/rate`), 15_000);
  const monthFeed = usePolledData("token-history:30d:1d", () => fetchTokenHistory("30d", "1d"), 60_000);
  const revenueFeed = usePolledData(`token-history:${revenueRange}`, () => fetchTokenHistory(revenueRange, REVENUE_INTERVAL[revenueRange]), 30_000);
  const supplyFeed = usePolledData(`token-history:${supplyRange}`, () => fetchTokenHistory(supplyRange), 30_000);
  const rewardsFeed = usePolledData(`token-history:${rewardsRange}`, () => fetchTokenHistory(rewardsRange), 30_000);
  const activityFeed = usePolledData(user ? `token-activity:${user}` : null, () => fetchActivity({ user, kind: "staking,mint", limit: 25 }).then(mapActivityPage), 15_000);
  const info = tokenFeed.data;
  const totalStaked = Number(info?.staking.totalStaked ?? 0);
  const distributed = Number(info?.rewards.distributed ?? 0);
  const last = info?.rewards.lastDistribution;
  const rate = Number(rateFeed.data?.rate ?? info?.rate ?? 0);
  const share = stakeShare(account.staked, totalStaked);
  const monthPoints = monthFeed.data?.points ?? [];
  const yours30 = rewardEstimate({ points: monthPoints, days: 30, staked: account.staked, totalStaked });
  const yours7 = rewardEstimate({ points: monthPoints, days: 7, staked: account.staked, totalStaked });
  const tokens = Math.max(0, Number(loss) || 0) * rate;
  const simulated = rewardEstimate({ points: monthPoints, days: 30, totalStaked, extra: tokens });
  const unavailable = (feed) => feed.error && !feed.data ? <DataError error={feed.error} onRetry={feed.retry}/> : null;
  async function submit(e) {
    e.preventDefault();
    if (!walletConnected) { setModal({type:"wallet"}); return; }
    const r = await account.stake(Number(amount), mode === "unstake");
    if (!r.ok) setError(r.error);
    else {
      setError("");
      setAmount("");
      notify(mode === "stake" ? "HOUSE staked on-chain." : "HOUSE unstaked on-chain.");
    }
  }
  return (
    <Shell
      dashboard="token"
      title="A stake in the house."
      kicker="代币 / TOKEN"
      subtitle="Losses can mint HOUSE. Staking can share revenue. A token reward does not erase a loss."
    >
      <div className="ds-overview">
        <aside className="ds-summary-grid">
        <div className="ds-summary-column">
          {" "}
          <section className="hm-panel pm-claim">
            <span className="pm-eyebrow">CLAIMABLE USDG</span>
            <strong>{rewardUsd(account.claimable)}</strong>
            <button
              className="luna-btn luna-btn-active"
              disabled={walletConnected && account.claimable <= 0}
              onClick={async () => {
                if(!walletConnected){setModal({type:"wallet"});return;}
                const result = await account.claim();
                if (result.ok) notify("Rewards claimed into your Exchange balance.");
                else notify(result.error);
              }}
            >
              {walletConnected ? "Claim rewards ↗" : "Connect wallet"}
            </button>
          </section>
          <Panel title="Rewards">
            <StatRows rows={[
              ["Rewards claimed", rewardUsd(account.claimed)],
              ["Your stake share", percent(share)],
              ["Your share · last 7d", yours7 ? rewardUsd(yours7.perDay*7) : "No distributions in 7d"],
              ["Your share · last 30d", yours30 ? rewardUsd(yours30.perMonth) : "No distributions in 30d"],
              ["Total staker rewards", info ? "$"+money(distributed,2) : "—"],
              ["From fees", info ? "$"+money(Number(info.rewards.fromFees),2) : "—"],
              ["From LP surplus", info ? "$"+money(Number(info.rewards.fromLpExcess),2) : "—"],
              ["Reward currency", "USDG"],
            ]}/>
            {unavailable(tokenFeed)}
          </Panel>
          <Panel title="Distribution"><StatRows rows={[["Pending rewards", rewardUsd(account.claimable)],["Latest distribution",!info?"—":last?`${new Date(last.at*1000).toLocaleString()} · $${money(Number(last.amount),2)}`:"No distributions yet"],["Claim mode","Manual"]]}/></Panel>
        </div>
        <div className="ds-summary-column">
          <Panel title="HOUSE">
            <StatRows rows={[["Wallet balance",compact(account.token)],["Your staked HOUSE",compact(account.staked)],["Minted by your account",compact(account.minted)],["Total supply",info?compact(Number(info.token.totalSupply)):"—"],["Minted from losses",info?compact(Number(info.token.minted)):"—"],["Staked supply",info?compact(totalStaked):"—"],["Stakers",info?info.staking.stakers:"—"],["Stake ratio",info?.staking.stakedShare==null?"—":info.staking.stakedShare.toFixed(2)+"%"],["Transfers",info?(info.token.transfersEnabled?"Enabled":"Disabled"):"—"],["Token",short(info?.token.address??account.protocol?.config?.token?.address)],["Staking contract",short(account.protocol?.config?.contracts?.JackTradeStaking)]]}/>
          </Panel>
          <Panel title="Staking" aside={
            <FilterSelect
              label="Staking action"
              items={[["stake", "Stake"], ["unstake", "Unstake"]]}
              value={mode}
              onChange={(v) => { setMode(v); setError(""); }}
            />
          }>
            <form onSubmit={submit}>
              <label className="pm-field">
                HOUSE amount
                <input
                  type="number"
                  min="0.0001"
                  step="any"
                  aria-label="HOUSE amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="pm-text-button"
                onClick={() => setAmount(String(mode === "stake" ? account.token : account.staked))}
              >
                Max: {money(mode === "stake" ? account.token : account.staked, 4)}
              </button>
              <button className="luna-btn luna-btn-active pm-wide">
                {!walletConnected ? "Connect wallet" : mode === "stake" ? "Stake HOUSE" : "Unstake HOUSE"}
              </button>
              {error && (
                <p className="pm-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          </Panel>
        </div>
        </aside>
        <div className="pm-main-stack">
          {" "}
          <Panel
            title="HOUSE mint rate"
            className="pm-chart-panel"
            aside={
              <Hint text="Read from the Exchange contract: HOUSE minted per 1 USDG of trader loss at the current tracked LP balance." />
            }
          >
            <div className="pm-curve-legend">
              <span>Current: {rateFeed.data || info ? `${money(rate, 2)} HOUSE / 1 USDG lost` : "Loading…"}</span>
            </div>
            <StatRows rows={[["HOUSE per 1 USDG lost",rateFeed.data||info?money(rate,2):"—"],["Tracked LP",rateFeed.data?"$"+money(Number(rateFeed.data.trackedLp)):"—"]]}/>
            {unavailable(rateFeed)}
          </Panel>
          <Panel title="Staking revenue" className="ds-plot-panel" aside={<ChartTools label="Staking revenue range" range={revenueRange} onRange={setRevenueRange} ranges={[["24h","24H"],["7d","7D"],["30d","30D"]]} paused={revenuePaused} onPause={setRevenuePaused}/>}>
            {unavailable(revenueFeed)||<SnapshotChart paused={revenuePaused} height={210} xFormat={revenueRange==='24h'?undefined:dateLabel} empty={revenueFeed.loading?"Loading…":"No distributions yet."} label="USDG distributed to stakers per period" series={revenueFeed.data?[{name:"Distributed",bars:true,color:"#2d9562",data:pointSeries(revenueFeed.data.points,"distributed")}]:[]}/>}
          </Panel>

        </div>
      </div>
      <div className="ds-overview">
        <Panel title="Your HOUSE activity" aside={<span className="ds-source-tag">LAST 25</span>}>{!user?<div className="pm-empty">Connect your wallet to see your token activity.</div>:unavailable(activityFeed)||<ActivityTable rows={activityFeed.data?.rows??[]} empty={activityFeed.loading?"Loading…":"No token activity yet."}/>}</Panel>
        <div className="ds-summary-column">
          <Panel title="HOUSE minted and staked" className="ds-plot-panel" aside={<ChartTools label="HOUSE supply range" range={supplyRange} onRange={setSupplyRange} ranges={[["all","All"],["30d","30D"],["7d","7D"]]} paused={supplyPaused} onPause={setSupplyPaused}/>}>{unavailable(supplyFeed)||<SnapshotChart paused={supplyPaused} xFormat={dateLabel} height={250} format={compact} empty={supplyFeed.loading?"Loading…":"No HOUSE minted yet."} label="HOUSE minted from losses and total staked over time" series={supplyFeed.data?[{name:"Minted",data:cumulativeSeries(supplyFeed.data.points,"minted",info?.token.minted),fill:true},{name:"Staked",data:pointSeries(supplyFeed.data.points,"totalStaked"),color:"#2d9562"}]:[]}/>}</Panel>
          <Panel title="Total staking rewards" className="ds-plot-panel" aside={<ChartTools label="Staking rewards range" range={rewardsRange} onRange={setRewardsRange} ranges={[["all","All"],["30d","30D"],["7d","7D"]]} paused={rewardsPaused} onPause={setRewardsPaused}/>}>{unavailable(rewardsFeed)||<SnapshotChart paused={rewardsPaused} xFormat={dateLabel} height={250} empty={rewardsFeed.loading?"Loading…":"No distributions yet."} label="USDG distributed to stakers, cumulative" series={rewardsFeed.data?[{name:"USDG rewards",data:cumulativeSeries(rewardsFeed.data.points,"distributed",info?.rewards.distributed),fill:true}]:[]}/>}</Panel>
        </div>
      </div>
      <div className="ds-simulator-row">
        <Panel
          title="Loss simulator"
          collapsible
        >
          <label className="pm-field">
            If you lose / USDG
            <input
              aria-label="Simulated loss amount"
              type="number"
              min="0"
              value={loss}
              onChange={(e) => setLoss(e.target.value)}
            />
          </label>
          <div className="pm-simulator-result">
            <span>
              ≈ {compact(tokens)} <b>HOUSE</b>
            </span>
            <small>{money(rate, 2)} tokens per $1 lost at the current rate</small>
          </div>
          <p>
            {simulated
              ? <>Staked, at the last 30 days of real distributions (${money(simulated.distributed)}) and {compact(totalStaked)} HOUSE already staked: <strong>≈ ${money(simulated.perMonth)}/month</strong>.</>
              : "No rewards were distributed in the last 30 days, so there is no basis for a reward estimate."}
          </p>
          <small className="pm-muted">
            Based on past distributions only, assuming immediate staking and unchanged revenue/stake. Not a forecast or
            token price.
          </small>
        </Panel>
      </div>
    </Shell>
  );
}
