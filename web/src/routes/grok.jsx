// Connect Grok: give Grok (or any MCP client) a trading key that can open and close bets but never withdraw,
// set its limits, and hand back the private connector URL to paste into Grok.
import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getAddress, isAddress } from "viem";
import { Shell } from "@/components/product/ProductUI";
import { CopyButton, ErrorBox, Note, PageHead, Step, TxHash, fmtUsd, short } from "@/components/grok/GrokUI";
import { connectFinish, connectStart, getAccount, getAction, getRelayerConfig, postAction } from "@/lib/grok/api";
import { SESSION_KEY_MANAGER_ABI } from "@/lib/grok/config";
import { ensureChain, errMsg, publicClient, useGrokWallet } from "@/lib/grok/wallet";

const MIN_BALANCE = 10; // market minMargin is 10 USDG
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randomUint256() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return BigInt("0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""));
}

const storeKey = (wallet) => `jt-grok-agent:${wallet.toLowerCase()}`;
function loadAgent(wallet) {
  try {
    return JSON.parse(localStorage.getItem(storeKey(wallet)) || "null");
  } catch {
    return null;
  }
}
function saveAgent(wallet, data) {
  try {
    localStorage.setItem(storeKey(wallet), JSON.stringify(data));
  } catch {
    /* works without storage */
  }
}

const TOOLS = [
  ["house_status", "Bankroll and payout queue before every bet"],
  ["list_markets", "Live prices and max leverage"],
  ["quote_bet", "Entry, size and liquidation, without placing"],
  ["place_bet", "Opens the bet, only after you confirm"],
  ["my_bets", "Open bets with live PnL"],
  ["cash_out", "Closes a bet at the current price"],
  ["make_it_real", "Link to buy the real token"],
  ["my_points", "Your JackTrade Points"],
];

export default function GrokPage() {
  const wallet = useGrokWallet();
  const account = wallet.address;

  const [info, setInfo] = useState(null);
  const [balanceErr, setBalanceErr] = useState("");

  const [pending, setPending] = useState(null); // {pendingId, agentAddress, expiry}
  const [regStatus, setRegStatus] = useState("");
  const [regTx, setRegTx] = useState(null);
  const [registered, setRegistered] = useState(false);
  const [regErr, setRegErr] = useState("");
  const [regBusy, setRegBusy] = useState(false);

  const [caps, setCaps] = useState({ maxMarginUsd: "25", maxLeverage: "100", dailyLossUsd: "50" });
  const [finishBusy, setFinishBusy] = useState(false);
  const [finishErr, setFinishErr] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");

  const [revokeKey, setRevokeKey] = useState("");
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeMsg, setRevokeMsg] = useState("");
  const [revokeErr, setRevokeErr] = useState("");
  const [revokeTx, setRevokeTx] = useState(null);

  // Start over when the wallet changes.
  useEffect(() => {
    setInfo(null);
    setPending(null);
    setRegistered(false);
    setRegStatus("");
    setRegErr("");
    setRegTx(null);
    setMcpUrl("");
    setFinishErr("");
    setRevokeMsg("");
    setRevokeErr("");
    setRevokeTx(null);
    setRevokeKey(account ? loadAgent(account)?.agentAddress || "" : "");
  }, [account]);

  const loadBalance = useCallback(async () => {
    if (!account) return;
    setBalanceErr("");
    try {
      setInfo(await getAccount(account));
    } catch (err) {
      setBalanceErr(`Couldn't load your JackTrade balance: ${err.message}`);
    }
  }, [account]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  const balance = info ? Number(info.balance) : null;
  const lowBalance = balance !== null && balance < MIN_BALANCE;

  async function registerKey() {
    setRegErr("");
    setRegBusy(true);
    setRegistered(false);
    setRegTx(null);
    try {
      await ensureChain(wallet);
      setRegStatus("Creating Grok's trading key…");
      const start = await connectStart(account);
      if (!start?.pendingId || !isAddress(start?.agentAddress || "")) {
        throw new Error("The connector returned an unexpected response.");
      }
      setPending(start);
      const agentAddress = getAddress(start.agentAddress);
      saveAgent(account, { agentAddress });
      setRevokeKey(agentAddress);

      setRegStatus("Reading the exchange config…");
      const config = await getRelayerConfig(true);
      const skm = config.contracts.SessionKeyManager;
      const sk = config.eip712Actions.sessionKeys;
      const epoch = await publicClient.readContract({
        address: skm,
        abi: SESSION_KEY_MANAGER_ABI,
        functionName: "epochOf",
        args: [account],
      });
      const now = Number(config.chainTime) || Math.floor(Date.now() / 1000);
      const message = {
        user: account,
        key: agentAddress,
        expiry: BigInt(start.expiry),
        epoch: BigInt(epoch),
        nonce: randomUint256(),
        deadline: BigInt(now + 600),
      };

      setRegStatus("Sign in your wallet to approve Grok's key (no gas)…");
      const signature = await wallet.walletClient.signTypedData({
        account,
        domain: { ...sk.domain, chainId: Number(sk.domain.chainId) },
        types: { RegisterSessionKey: sk.types.RegisterSessionKey },
        primaryType: "RegisterSessionKey",
        message,
      });

      setRegStatus("Submitting to the relayer…");
      const action = {
        user: account,
        key: agentAddress,
        expiry: message.expiry.toString(),
        epoch: message.epoch.toString(),
        nonce: message.nonce.toString(),
        deadline: message.deadline.toString(),
      };
      const res = await postAction({ kind: "registerSessionKey", action, signature });
      const id = res?.id;
      if (!id) throw new Error("The relayer did not return an action id.");

      const txOf = (a) => a?.txHash || a?.hash || a?.result?.txHash || null;
      let final = res;
      for (let i = 0; i < 90; i++) {
        const st = String(final?.status || "").toLowerCase();
        if (txOf(final)) setRegTx(txOf(final));
        if (st === "executed" || st === "failed") break;
        setRegStatus(`Relayer: ${st || "queued"}…`);
        await sleep(2000);
        final = await getAction(id);
      }
      const st = String(final?.status || "").toLowerCase();
      if (txOf(final)) setRegTx(txOf(final));
      if (st === "failed") {
        const code = final.code || final.error?.code || "failed";
        const msg = final.message || final.error?.message || (typeof final.error === "string" ? final.error : "");
        throw new Error(`Relayer failed (${code})${msg ? `: ${msg}` : ""}`);
      }
      if (st !== "executed") throw new Error("Timed out waiting for the relayer. Try again in a minute.");

      setRegStatus("Checking the key onchain…");
      let valid = false;
      for (let i = 0; i < 5 && !valid; i++) {
        valid = await publicClient.readContract({
          address: skm,
          abi: SESSION_KEY_MANAGER_ABI,
          functionName: "isValidSessionKey",
          args: [account, agentAddress],
        });
        if (!valid) await sleep(1500);
      }
      if (!valid) throw new Error("The relayer executed, but the key isn't valid onchain yet. Try again shortly.");
      setRegistered(true);
      setRegStatus("Grok's key is approved onchain.");
    } catch (err) {
      setRegErr(errMsg(err));
      setRegStatus("");
    } finally {
      setRegBusy(false);
    }
  }

  async function finish(e) {
    e.preventDefault();
    setFinishErr("");
    const c = {
      maxMarginUsd: Number(caps.maxMarginUsd),
      maxLeverage: Math.floor(Number(caps.maxLeverage)),
      dailyLossUsd: Number(caps.dailyLossUsd),
    };
    if (!(c.maxMarginUsd > 0) || !(c.maxLeverage >= 1) || !(c.dailyLossUsd > 0)) {
      setFinishErr("All limits must be positive numbers.");
      return;
    }
    if (c.maxMarginUsd < MIN_BALANCE) {
      setFinishErr(`Max margin per bet must be at least $${MIN_BALANCE} (the exchange minimum).`);
      return;
    }
    setFinishBusy(true);
    try {
      const res = await connectFinish(pending.pendingId, c);
      if (!res?.mcpUrl) throw new Error("The connector did not return a URL.");
      setMcpUrl(res.mcpUrl);
    } catch (err) {
      setFinishErr(errMsg(err));
    } finally {
      setFinishBusy(false);
    }
  }

  async function revoke() {
    setRevokeErr("");
    setRevokeMsg("");
    setRevokeTx(null);
    if (!isAddress(revokeKey)) {
      setRevokeErr("Enter Grok's key address (0x…).");
      return;
    }
    setRevokeBusy(true);
    try {
      await ensureChain(wallet);
      const config = await getRelayerConfig();
      const skm = config.contracts.SessionKeyManager;
      const hash = await wallet.walletClient.writeContract({
        account,
        address: skm,
        abi: SESSION_KEY_MANAGER_ABI,
        functionName: "revokeSessionKey",
        args: [getAddress(revokeKey)],
      });
      setRevokeTx(hash);
      setRevokeMsg("Waiting for confirmation…");
      const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (r.status !== "success") throw new Error("The revoke transaction reverted.");
      const still = await publicClient.readContract({
        address: skm,
        abi: SESSION_KEY_MANAGER_ABI,
        functionName: "isValidSessionKey",
        args: [account, getAddress(revokeKey)],
      });
      setRevokeMsg(still ? "The transaction landed but the key still reads as valid." : "Revoked. Grok can no longer trade for you.");
      if (!still) setRegistered(false);
    } catch (err) {
      setRevokeErr(errMsg(err));
      setRevokeMsg("");
    } finally {
      setRevokeBusy(false);
    }
  }

  const s1 = account ? "done" : "active";
  const s2 = s1 !== "done" ? "todo" : info && !lowBalance ? "done" : "active";
  const s3 = s1 !== "done" ? "todo" : registered ? "done" : regErr ? "error" : "active";
  const s4 = !registered ? "todo" : mcpUrl ? "done" : "active";
  const s5 = mcpUrl ? "active" : "todo";

  return (
    <Shell>
      <div className="jt-page">
        <PageHead title="Trade from Grok">
          Connect JackTrade to Grok once. Then ask it what the news means for a market and tell it to trade, right in the
          chat.
        </PageHead>

        <div className="jt-split">
          <ol className="jt-steps">
            <Step n={1} title="Connect your wallet" state={s1}>
              {!account ? (
                <button className="jt-btn" type="button" onClick={wallet.connect}>
                  Connect wallet
                </button>
              ) : (
                <p>
                  Connected as <span className="jt-mono">{short(account, 6)}</span> on Robinhood Chain.
                </p>
              )}
            </Step>

            <Step n={2} title="Check your balance" hint="Trades need at least $10 of margin." state={s2}>
              {balance === null && !balanceErr && <p className="jt-muted">Loading balance…</p>}
              {balance !== null && (
                <div className="jt-row">
                  <span className="jt-figure">{fmtUsd(balance)}</span>
                  <button className="jt-btn-ghost" type="button" onClick={loadBalance}>
                    Refresh
                  </button>
                  {lowBalance && (
                    <button className="jt-btn-ghost" type="button" onClick={wallet.deposit}>
                      Deposit
                    </button>
                  )}
                </div>
              )}
              {lowBalance && (
                <Note>
                  {balance === 0 ? "Your balance is empty." : `Trades need at least $${MIN_BALANCE} of margin.`} Deposit
                  USDG, then hit Refresh. You can still connect Grok now.
                </Note>
              )}
              <ErrorBox error={balanceErr} />
            </Step>

            <Step n={3} title="Approve Grok's trading key" hint="One signature, no gas. The key can never withdraw." state={s3}>
              <p>
                We create a key just for Grok. You sign once, with no gas, to register it. It can open and close trades
                for you. It can't withdraw.
              </p>
              {pending?.agentAddress && (
                <p className="jt-small jt-muted">
                  Key <span className="jt-mono">{short(pending.agentAddress, 6)}</span>
                  {pending.expiry && <> · expires {new Date(Number(pending.expiry) * 1000).toLocaleDateString()}</>}
                </p>
              )}
              {!registered && (
                <button className="jt-btn" type="button" onClick={registerKey} disabled={regBusy || s1 !== "done"}>
                  {regBusy ? "Working…" : regErr ? "Try again" : "Approve key"}
                </button>
              )}
              {regStatus && <p className={registered ? "jt-ok" : "jt-muted"}>{regStatus}</p>}
              {regTx && (
                <p className="jt-small jt-muted">
                  Relayer tx <TxHash hash={regTx} />
                </p>
              )}
              <ErrorBox error={regErr} />
            </Step>

            <Step n={4} title="Set Grok's limits" hint="Max per trade, max leverage and a daily loss limit." state={s4}>
              <p className="jt-muted">Checked before every trade Grok places.</p>
              <form className="jt-limits" onSubmit={finish}>
                <label>
                  <span>Max per trade</span>
                  <span className="jt-affix">
                    <i>$</i>
                    <input type="number" min="10" step="1" value={caps.maxMarginUsd} onChange={(e) => setCaps({ ...caps, maxMarginUsd: e.target.value })} disabled={Boolean(mcpUrl)} />
                  </span>
                </label>
                <label>
                  <span>Max leverage</span>
                  <span className="jt-affix">
                    <input type="number" min="1" step="1" value={caps.maxLeverage} onChange={(e) => setCaps({ ...caps, maxLeverage: e.target.value })} disabled={Boolean(mcpUrl)} />
                    <i>×</i>
                  </span>
                </label>
                <label>
                  <span>Daily loss limit</span>
                  <span className="jt-affix">
                    <i>$</i>
                    <input type="number" min="1" step="1" value={caps.dailyLossUsd} onChange={(e) => setCaps({ ...caps, dailyLossUsd: e.target.value })} disabled={Boolean(mcpUrl)} />
                  </span>
                </label>
                {!mcpUrl && (
                  <button className="jt-btn" type="submit" disabled={finishBusy || !registered}>
                    {finishBusy ? "Saving…" : "Save and get my link"}
                  </button>
                )}
              </form>
              <ErrorBox error={finishErr} />
            </Step>

            <Step n={5} title="Add JackTrade to Grok" hint="Paste your private link into Grok's connectors." state={s5}>
              <p>Your private link. Treat it like a password: anyone with it can trade with Grok's key.</p>
              <div className="jt-copy">
                <code className="jt-mono jt-selectable">{mcpUrl}</code>
                <CopyButton text={mcpUrl} label="Copy" className="jt-btn" />
              </div>
              <ol className="jt-howto">
                <li>
                  Open{" "}
                  <a href="https://grok.com/connectors" target="_blank" rel="noreferrer">
                    grok.com/connectors
                  </a>
                  .
                </li>
                <li>
                  Click <b>New Connector</b>, then <b>Custom</b>.
                </li>
                <li>Paste the link, name it "JackTrade" and save.</li>
                <li>
                  In a new chat, try: <i>"What does today's news mean for BTC? If you agree, go long $20 at 50x."</i>
                </li>
              </ol>
            </Step>
          </ol>

          <aside className="jt-aside">
            <div className="jt-card-plain">
              <div className="jt-aside-title">
                <img src="/brand/jack-256.webp" alt="" width="28" height="28" />
                <h3>What Grok can do</h3>
              </div>
              <ul className="jt-tool-list">
                {TOOLS.map(([name, desc]) => (
                  <li key={name}>
                    <code>{name}</code>
                    <span>{desc}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="jt-card-plain">
              <h3>Safe by design</h3>
              <p>Grok's key can open and close trades. It can never withdraw, and you can revoke it whenever you want.</p>
              <p>
                Works with any MCP client: Claude, ChatGPT and others use the same link. Trades placed by agents show up
                in <Link to="/bets">Agent bets</Link>.
              </p>
            </div>

            {account && (
              <div className="jt-card-plain">
                <h3>Revoke Grok's key</h3>
                <p className="jt-muted">Needs a little ETH for gas. Grok stops trading immediately.</p>
                <div className="jt-copy">
                  <input className="jt-input jt-mono" placeholder="Key address 0x…" value={revokeKey} onChange={(e) => setRevokeKey(e.target.value.trim())} />
                  <button className="jt-btn-ghost is-danger" type="button" onClick={revoke} disabled={revokeBusy}>
                    {revokeBusy ? "Revoking…" : "Revoke"}
                  </button>
                </div>
                {revokeTx && (
                  <p className="jt-small jt-muted">
                    Tx <TxHash hash={revokeTx} />
                  </p>
                )}
                {revokeMsg && <p className="jt-ok">{revokeMsg}</p>}
                <ErrorBox error={revokeErr} />
              </div>
            )}
          </aside>
        </div>
      </div>
    </Shell>
  );
}
