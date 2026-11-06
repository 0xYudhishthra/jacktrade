import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Shell } from "@/components/product/ProductUI";
import { useTradingSession } from "@/hooks/useTradingSession";
import { LEVERAGE, money } from "@/lib/protocolModel";
import { MIN_MARGIN, MIN_POSITION_SIZE } from "@/lib/orderMinimums";
import { EXPLORER_URL } from "@/lib/backend";

// Product docs. Every number that the protocol sets is read live (GET /api/config, /api/markets), with the launch
// values from the contracts as the fallback while it loads.
const LAUNCH = {
  fees: { winFeeBps: 200, lossFeeBps: 200, liqFeeBps: 200 },
  limits: { minDeposit: 10, minWithdraw: 10, activationFee: 1, deadbandDivisor: 50_000, escapeDelay: 86_400 },
  market: { maxLeverage: 1000, liqBufferBps: 5, maxConfBps: 20, maxNotional: 100_000, longOiCap: 250_000 },
  impact: { baseRate: 0.1, rateMultiplier: 15_000, referenceNotional: 100_000, positionMultiplier: { "BTC-PERP": 814.598, "ETH-PERP": 483.979 } },
};
const EXPLORER = EXPLORER_URL ? `${EXPLORER_URL}/address/` : "";
const CONTRACTS = [
  ["Exchange", "0x698cf1a9220f89ccf6ee75269086288a623ede54", "Balances, positions, settlement, the house pool and the payout queue."],
  ["BatchExecutor", "0xf612485f65e0ea7109a3eb09ea7e0abfabd167a4", "Executes signed orders submitted by the relayer, with the Pyth price update."],
  ["SessionKeyManager", "0xe82bb6f411a9a53170f9c4fff53207eb80b7bb29", "One-click trading keys: register, expire, revoke."],
  ["PriceOracle", "0xaed4385e882c823e202d8e34f08dd7cda55e73d9", "Pyth adapter: freshness and confidence checks."],
  ["Token", "0x10f1fd34d2b3b1b6e5a56b4e08e44d25d9df7a76", "HOUSE, the ERC-20 minted on trader losses."],
  ["Tokenomics", "0xe7ac6846d9c5ffa92f3e45dd50335c4fe478633d", "The HOUSE emission curve."],
  ["Staking", "0xbe4fe6490c3feb50bfb347ac5ce641673e25d0bd", "HOUSE staking and USDG rewards."],
  ["USDG", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "Collateral (Paxos Global Dollar, 6 decimals)."],
];
const NAV = [
  ["Getting started", [["overview", "Overview"], ["quick-start", "Quick start"]]],
  ["Trading", [["markets", "Markets"], ["positions", "Opening a position"], ["settlement", "Closing and profit"], ["liquidation", "Liquidation"], ["fees", "Fees"], ["limits", "Limits"]]],
  ["The house", [["pool", "The house pool"], ["queue", "Payout queue"]]],
  ["HOUSE token", [["emissions", "Earning HOUSE"], ["staking", "Staking"]]],
  ["Account", [["wallets", "Wallets and sign-in"], ["funds", "Deposits and withdrawals"], ["one-click", "One-click trading"], ["escape", "Escape hatch"]]],
  ["Reference", [["risks", "Risks"], ["contracts", "Contracts"], ["faq", "FAQ"]]],
];
const pct = (bps) => `${(Number(bps) / 100).toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;
const usd = (n) => `$${money(Number(n), 0)}`;

// Share of the raw gain a winning close pays, as the Exchange computes it (PnLMath.winningGain), before the win fee.
function keptShare(move, impact, deadbandDivisor) {
  const eff = move - 1 / deadbandDivisor;
  if (eff <= 0) return 0;
  const scale = (1 - impact.baseRate) / (1 + 1 / (eff * impact.rateMultiplier) + impact.referenceNotional / (1e6 * eff * impact.positionMultiplier));
  return (eff / move) * scale;
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="jt-docs-section">
      <h2>
        <a href={`#${id}`}>{title}</a>
      </h2>
      {children}
    </section>
  );
}

function Note({ children }) {
  return <aside className="jt-docs-note">{children}</aside>;
}

export default function Help() {
  const { markets, fees: liveFees, protocolLimits } = useTradingSession();
  const fees = liveFees ?? LAUNCH.fees;
  const limits = { ...LAUNCH.limits, ...Object.fromEntries(Object.entries(protocolLimits ?? {}).map(([k, v]) => [k, Number(v)])) };
  const listed = markets.filter((m) => m.listed);
  const previews = markets.filter((m) => m.closed);
  const market = (m) => ({ ...LAUNCH.market, ...(m?.protocol ?? {}) });
  const first = market(listed[0]);
  const impactOf = (m) => {
    const live = m.protocol?.impact;
    if (live) return Object.fromEntries(Object.entries(live).map(([k, v]) => [k, Number(v)]));
    return { ...LAUNCH.impact, positionMultiplier: LAUNCH.impact.positionMultiplier[m.symbol] ?? 500 };
  };
  const winKeep = 1 - Number(fees.winFeeBps) / 10_000;
  const moves = [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05];
  const escapeHours = Math.round(limits.escapeDelay / 3600);

  // Highlight the section being read in the sidebar.
  const [active, setActive] = useState("overview");
  useEffect(() => {
    const sections = [...document.querySelectorAll(".jt-docs-section")];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);
  // On phones the sections are a horizontal strip: keep the current one in view.
  useEffect(() => {
    const nav = document.querySelector(".jt-docs-nav");
    const link = nav?.querySelector(`a[href="#${active}"]`);
    if (!nav || !link || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: link.offsetLeft - nav.clientWidth / 2 + link.clientWidth / 2, behavior: "smooth" });
  }, [active]);
  // Links from before these docs (#model) land on the closest section.
  useEffect(() => {
    const alias = { "#model": "pool" }[window.location.hash];
    if (alias) document.getElementById(alias)?.scrollIntoView();
  }, []);

  return (
    <Shell>
      <div className="jt-docs">
        <nav className="jt-docs-nav" aria-label="Documentation">
          {NAV.map(([group, items]) => (
            <div key={group}>
              <strong>{group}</strong>
              {items.map(([id, label]) => (
                <a key={id} href={`#${id}`} aria-current={active === id ? "location" : undefined}>
                  {label}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <article className="jt-docs-body">
          <header className="jt-docs-hero">
            <span>Documentation</span>
            <h1>JackTrade</h1>
            <p>
              Leveraged perpetuals on crypto and US equities, traded against the house on Robinhood Chain. Up to{" "}
              {money(first.maxLeverage, 0)}× leverage, no order book, no funding, no gas.
            </p>
          </header>

          <Section id="overview" title="Overview">
            <p>
              JackTrade is a perpetual futures exchange where every trade is taken by a single counterparty: the{" "}
              <strong>house pool</strong>. You go long or short at the live Pyth oracle price, with margin in USDG, and
              settle against the pool when you close.
            </p>
            <ul className="jt-docs-points">
              <li><strong>No order book.</strong> Orders fill at the oracle price; there is nobody to match.</li>
              <li><strong>No funding, no spread.</strong> Holding a position costs nothing. Fees apply only when you close.</li>
              <li><strong>No gas.</strong> You sign; the relayer submits and pays the gas.</li>
              <li><strong>Lose-to-earn.</strong> Every loss mints HOUSE, the token that shares the house&apos;s revenue.</li>
            </ul>
            <p>
              Everything settles on-chain in the Exchange contract. Balances, positions and history are public on{" "}
              {EXPLORER ? <a href={`${EXPLORER}${CONTRACTS[0][1]}`} target="_blank" rel="noreferrer">the block explorer</a> : "the block explorer"}.
            </p>
          </Section>

          <Section id="quick-start" title="Quick start">
            <ol className="jt-docs-steps">
              <li>
                <strong>Connect.</strong> Use any wallet (MetaMask, Rabby, Coinbase Wallet, Phantom and hundreds more,
                desktop or phone) or sign in with email, Google, X or Apple.
              </li>
              <li>
                <strong>Deposit USDG.</strong> From your wallet on Robinhood Chain, or any token from another chain. The
                minimum is {usd(limits.minDeposit)}, plus a one-time {usd(limits.activationFee)} activation fee on your
                first deposit.
              </li>
              <li>
                <strong>Enable one-click trading.</strong> One signature creates a trading key in this browser, so orders
                don&apos;t need a wallet prompt each time.
              </li>
              <li>
                <strong>Trade.</strong> Pick a market, long or short, margin and leverage. Close whenever you want.
              </li>
            </ol>
            <Link className="jt-docs-cta" to="/trade">Open the trading screen →</Link>
          </Section>

          <Section id="markets" title="Markets">
            <div className="jt-docs-table">
              <table>
                <thead><tr><th>Market</th><th>Status</th><th>Max leverage</th><th>Hours</th></tr></thead>
                <tbody>
                  {markets.map((m) => (
                    <tr key={m.symbol}>
                      <td><strong>{m.symbol.replace("-PERP", "")}</strong> <span className="jt-docs-muted">{m.name.replace(" · equity", "")}</span></td>
                      <td>{m.listed ? "Live" : m.closed ? "Preview" : "Not listed"}</td>
                      <td>{m.listed ? `${money(market(m).maxLeverage, 0)}×` : "—"}</td>
                      <td>{m.kind === "equity" ? "US market hours" : "24/7"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Prices come from <strong>Pyth</strong> and are pushed on-chain with every order. An order is rejected if the
              price is stale, if it was published before you signed, or if Pyth&apos;s confidence interval is wider than{" "}
              {pct(first.maxConfBps)} of the price.
            </p>
            <Note>
              Equities trade only while Pyth publishes prices (US market hours, including extended hours). Outside them,
              opening, closing and liquidations wait for the open.
              {previews.length > 0 && ` ${previews.map((m) => m.symbol.replace("-PERP", "")).join(" and ")} ${previews.length > 1 ? "are" : "is"} in preview: live price and charts, not tradable yet.`}
            </Note>
          </Section>

          <Section id="positions" title="Opening a position">
            <p>A position has four inputs: market, direction, margin and leverage.</p>
            <dl className="jt-docs-terms">
              <div><dt>Margin</dt><dd>The USDG you commit. It is the most the position can lose.</dd></div>
              <div><dt>Leverage</dt><dd>{LEVERAGE.min}× to {money(first.maxLeverage, 0)}×, in {LEVERAGE.step}× steps.</dd></div>
              <div><dt>Position size</dt><dd>Margin × leverage. Profit and loss are computed on this amount.</dd></div>
            </dl>
            <p>
              Margin is <strong>isolated</strong>: each position stands alone, and your free balance and other positions
              are never used to cover it. Positions are <strong>fixed</strong>: you can&apos;t add margin or close part of
              one. To change a position, close it and open a new one.
            </p>
            <Note>
              Example: 50 USDG at 100× opens a $5,000 position. A 1% move in your favour is a $50 raw gain; a 1% move
              against you liquidates it and the 50 USDG are lost.
            </Note>
          </Section>

          <Section id="settlement" title="Closing and profit">
            <p>
              <strong>Losses</strong> are exact: the price move times your position size, capped at your margin. Whatever
              is left of the margin comes back to your balance immediately.
            </p>
            <p><strong>Profits</strong> go through three steps, all computed by the contract:</p>
            <ol className="jt-docs-steps is-compact">
              <li>
                <strong>Dead zone.</strong> The first {pct(10_000 / limits.deadbandDivisor)} of the move from your entry
                doesn&apos;t count.
              </li>
              <li>
                <strong>Price impact.</strong> The gain is scaled by a factor that is small for tiny moves and approaches
                90% for large ones. Scalping tiny moves pays much less than their raw value.
              </li>
              <li><strong>Win fee.</strong> {pct(fees.winFeeBps)} of what remains.</li>
            </ol>
            <p>Share of the raw gain you receive, by how far the price moved in your favour:</p>
            <div className="jt-docs-table">
              <table>
                <thead>
                  <tr>
                    <th>Move</th>
                    {listed.map((m) => <th key={m.symbol}>{m.symbol.replace("-PERP", "")}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {moves.map((move) => (
                    <tr key={move}>
                      <td>{(move * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%</td>
                      {listed.map((m) => (
                        <td key={m.symbol}>{(keptShare(move, impactOf(m), limits.deadbandDivisor) * winKeep * 100).toFixed(1)}%</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="jt-docs-formula">
              <summary>Exact formula</summary>
              <p>With <code>move</code> = (|exit − entry| − entry / {money(limits.deadbandDivisor, 0)}) / entry:</p>
              <pre>{"scale = (1 − baseRate) / (1 + 1 / (move × rateMultiplier) + referenceNotional / (10⁶ × move × positionMultiplier))\ngain  = size × move × scale × (1 − winFee)"}</pre>
              <p>
                Launch parameters: baseRate 10%, rateMultiplier 15,000, referenceNotional $100,000, positionMultiplier
                814.598 (BTC) and 483.979 (ETH).
              </p>
            </details>
          </Section>

          <Section id="liquidation" title="Liquidation">
            <p>
              A position is liquidated when the price moves against it by 1 / leverage, minus a buffer of{" "}
              {pct(first.liqBufferBps)}. On liquidation the entire margin goes to the house.
            </p>
            <div className="jt-docs-table">
              <table>
                <thead><tr><th>Leverage</th><th>Price move to liquidation</th></tr></thead>
                <tbody>
                  {[10, 50, 100, 500, 1000].filter((l) => l <= first.maxLeverage).map((l) => (
                    <tr key={l}>
                      <td>{l}×</td>
                      <td>{(100 / l - Number(first.liqBufferBps) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              A keeper liquidates the moment the oracle price crosses the trigger. In a fast market the price can jump
              past it; the loss is still capped at your margin.
            </p>
          </Section>

          <Section id="fees" title="Fees">
            <div className="jt-docs-table">
              <table>
                <thead><tr><th>Fee</th><th>Amount</th><th>Who pays</th></tr></thead>
                <tbody>
                  <tr><td>Opening, holding, funding, spread</td><td>None</td><td>—</td></tr>
                  <tr><td>Win fee</td><td>{pct(fees.winFeeBps)} of the profit</td><td>You, out of a winning close</td></tr>
                  <tr><td>Loss fee</td><td>{pct(fees.lossFeeBps)} of the loss</td><td>The house, out of your loss: nothing extra for you</td></tr>
                  <tr><td>Liquidation fee</td><td>{pct(fees.liqFeeBps)} of the margin</td><td>The house, out of the liquidated margin</td></tr>
                  <tr><td>Activation</td><td>{usd(limits.activationFee)}, once</td><td>You, on your first deposit</td></tr>
                  <tr><td>Gas</td><td>None</td><td>The relayer</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              Collected fees are split 50/50 between HOUSE stakers and the protocol. While the payout queue has entries,
              losses carry no fee: all of each loss goes to queued winners.
            </p>
          </Section>

          <Section id="limits" title="Limits">
            <div className="jt-docs-table">
              <table>
                <tbody>
                  <tr><th scope="row">Margin per position</th><td>From {usd(MIN_MARGIN)}</td></tr>
                  <tr><th scope="row">Position size</th><td>{usd(MIN_POSITION_SIZE)} to {usd(first.maxNotional)}</td></tr>
                  <tr><th scope="row">Open interest</th><td>Up to {usd(first.longOiCap)} per side, per market</td></tr>
                  <tr><th scope="row">Deposit</th><td>From {usd(limits.minDeposit)}</td></tr>
                  <tr><th scope="row">Withdrawal</th><td>From {usd(limits.minWithdraw)}, or your full balance</td></tr>
                </tbody>
              </table>
            </div>
            <p>Open-interest caps grow with the house. An order that would exceed one is rejected before it reaches the chain.</p>
          </Section>

          <Section id="pool" title="The house pool">
            <p>
              The house pool started at zero and is funded only by trader losses. When traders lose, the pool grows; when
              they win, the pool pays them. There is no outside liquidity provider who can pull it.
            </p>
            <p>
              The <Link to="/house">House</Link> page shows the pool in real time: free funds, deposits, total PnL, open
              interest by market, the payout queue and a liquidation heatmap.
            </p>
          </Section>

          <Section id="queue" title="Payout queue">
            <p>
              If the pool can&apos;t pay a winning close in full, the unpaid profit joins a first-in, first-out queue. Later
              trader losses pay the queue in order, and each payment lands in your balance automatically.
            </p>
            <ul className="jt-docs-points">
              <li>Only profit can be queued. Your margin always comes back immediately.</li>
              <li>The queue has no deadline: payment depends on future losses.</li>
              <li>While it has entries, every loss goes to queued winners, with no fee taken.</li>
            </ul>
          </Section>

          <Section id="emissions" title="Earning HOUSE">
            <p>
              Every losing close and every liquidation mints HOUSE to the trader. While the pool is below $2M, the rate is{" "}
              <strong>100 HOUSE per $1 lost</strong>. Above that, it decays as the pool reaches new highs:
            </p>
            <pre className="jt-docs-pre">{"rate = 100 × (S / (S + H))²\nS = $120M    H = pool growth above $2M (high-water mark)"}</pre>
            <p>
              HOUSE is a reward, not a refund, and has no guaranteed value. Transfers are disabled at launch: HOUSE can be
              held and staked.
            </p>
          </Section>

          <Section id="staking" title="Staking">
            <p>Staked HOUSE earns USDG from two sources, shared pro rata by stake:</p>
            <ul className="jt-docs-points">
              <li><strong>Fees.</strong> Half of every win, loss and liquidation fee.</li>
              <li><strong>Pool surplus.</strong> Any pool growth above $5M.</li>
            </ul>
            <p>
              There is no lockup or cooldown. Claimed rewards are credited to your trading balance, ready to trade or
              withdraw. Manage your stake on the <Link to="/token">Token</Link> page.
            </p>
          </Section>

          <Section id="wallets" title="Wallets and sign-in">
            <p>
              Connect any EVM wallet, directly or through WalletConnect, or sign in with email, Google, X or Apple (a
              wallet is created for you). On a phone you can open JackTrade in your wallet&apos;s browser or connect from
              your regular browser.
            </p>
            <p>The app switches your wallet to Robinhood Chain (chain id 4663) when a signature needs it.</p>
          </Section>

          <Section id="funds" title="Deposits and withdrawals">
            <p>
              Your trading balance lives in the Exchange contract, credited to your wallet address. Deposits and
              withdrawals take one signature; the relayer submits them and pays the gas.
            </p>
            <ul className="jt-docs-points">
              <li><strong>USDG on Robinhood Chain:</strong> deposit straight from your wallet.</li>
              <li><strong>Any token, any chain:</strong> the deposit routes through Trustware and lands in your trading balance.</li>
              <li><strong>Withdrawals</strong> arrive in your wallet as USDG on Robinhood Chain.</li>
            </ul>
          </Section>

          <Section id="one-click" title="One-click trading">
            <p>
              Signing every order in your wallet is slow. Instead, one signature registers a <strong>trading key</strong>{" "}
              that lives only in this browser, for up to 30 days.
            </p>
            <ul className="jt-docs-points">
              <li>It can open and close positions. It can&apos;t withdraw or move funds.</li>
              <li>Each order it signs is valid for one hour at most.</li>
              <li>Revoke it anytime in Settings → Session & limits. Revoking is an on-chain transaction and needs a little ETH.</li>
            </ul>
          </Section>

          <Section id="escape" title="Escape hatch">
            <p>
              Orders reach the chain through the relayer, but your funds never depend on it. You can always call{" "}
              <code>withdraw</code> on the Exchange from your own wallet, and if the relayer stops for more than{" "}
              {escapeHours} hours, the Exchange lets you close your positions directly.
            </p>
          </Section>

          <Section id="risks" title="Risks">
            <ul className="jt-docs-points">
              <li><strong>Leverage.</strong> At high leverage a tiny move liquidates a position. Only trade what you can lose.</li>
              <li><strong>Gaps.</strong> Prices can jump past your liquidation price, and equities can gap at the open.</li>
              <li><strong>Queue.</strong> If the pool is short, a winning close is paid later, not immediately.</li>
              <li><strong>Oracle.</strong> Prices depend on Pyth. A stale or uncertain price pauses opening.</li>
              <li><strong>Smart contracts.</strong> The contracts are new and upgradeable. Bugs are possible.</li>
              <li><strong>HOUSE.</strong> The token has no guaranteed value and isn&apos;t transferable at launch.</li>
            </ul>
          </Section>

          <Section id="contracts" title="Contracts">
            <p>Robinhood Chain mainnet, chain id 4663. Upgradeable proxies.</p>
            <div className="jt-docs-table">
              <table>
                <thead><tr><th>Contract</th><th>Address</th><th>Role</th></tr></thead>
                <tbody>
                  {CONTRACTS.map(([name, address, role]) => (
                    <tr key={name}>
                      <td><strong>{name}</strong></td>
                      <td>{EXPLORER ? <a href={`${EXPLORER}${address}`} target="_blank" rel="noreferrer"><code>{address.slice(0, 6)}…{address.slice(-4)}</code></a> : <code title={address}>{address}</code>}</td>
                      <td>{role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="faq" title="FAQ">
            {[
              ["Who is on the other side of my trade?", "The house pool. There's no other trader and no order book."],
              ["Can I lose more than my margin?", "No. Margin is isolated: a position can only lose its own margin."],
              ["Why did I get less than the price move?", "A winning close pays after the dead zone, price impact and the win fee. See Closing and profit."],
              ["Do I need ETH?", "No. Deposits, trades and withdrawals are gasless. Only revoking a trading key early needs a little ETH."],
              ["When can I trade SPY or TSLA?", "Once they're listed, during US market hours. Until then they're in preview."],
              ["Where are my funds?", "In the Exchange contract, credited to your wallet address. Withdraw them anytime."],
            ].map(([q, a]) => (
              <details key={q} className="jt-docs-faq">
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </Section>
        </article>
      </div>
    </Shell>
  );
}
