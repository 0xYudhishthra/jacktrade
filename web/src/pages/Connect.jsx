import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAddress, isAddress } from "viem";
import { useWallet } from "../components/Wallet.jsx";
import { CopyButton, ErrorBox, Step, TxHash, fmtUsd } from "../components/Common.jsx";
import {
  connectFinish,
  connectStart,
  getAccount,
  getAction,
  getRelayerConfig,
  postAction,
} from "../lib/api.js";
import { publicClient, sessionKeyManagerAbi, short } from "../lib/chain.js";
import { ensureChain, errMsg, hasWallet, walletClient } from "../lib/wallet.js";
import { JACKTRADE_URL } from "../lib/config.js";

const MIN_BALANCE = 10; // market minMargin is 10 USDG
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randomUint256() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return BigInt("0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""));
}

const storeKey = (wallet) => `hm-grok-agent:${wallet.toLowerCase()}`;
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
    /* ignore */
  }
}

export default function ConnectPage() {
  const { account, wrongChain, connect, switchChain, busy: walletBusy, error: walletError } = useWallet();

  const [account_, setAccountInfo] = useState(null);
  const [balanceErr, setBalanceErr] = useState("");

  const [pending, setPending] = useState(null); // {pendingId, agentAddress, expiry}
  const [regStatus, setRegStatus] = useState(""); // human status
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

  // Reset when the wallet changes.
  useEffect(() => {
    setAccountInfo(null);
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
      setAccountInfo(await getAccount(account));
    } catch (err) {
      setBalanceErr(`Couldn't load your JackTrade balance: ${err.message}`);
    }
  }, [account]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  const balance = account_ ? Number(account_.balance) : null;
  const lowBalance = balance !== null && balance < MIN_BALANCE;

  async function registerKey() {
    setRegErr("");
    setRegBusy(true);
    setRegistered(false);
    setRegTx(null);
    try {
      await ensureChain();
      setRegStatus("Creating Grok's trading key…");
      const start = await connectStart(account);
      if (!start?.pendingId || !isAddress(start?.agentAddress || "")) {
        throw new Error("Connector returned an unexpected response for /api/connect/start");
      }
      setPending(start);
      const agentAddress = getAddress(start.agentAddress);
      saveAgent(account, { agentAddress });
      setRevokeKey(agentAddress);

      setRegStatus("Reading JackTrade config…");
      const config = await getRelayerConfig(true);
      const skm = config.contracts.SessionKeyManager;
      const sk = config.eip712Actions.sessionKeys;
      const epoch = await publicClient.readContract({
        address: skm,
        abi: sessionKeyManagerAbi,
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
      const signature = await walletClient(account).signTypedData({
        account,
        domain: { ...sk.domain, chainId: Number(sk.domain.chainId) },
        types: { RegisterSessionKey: sk.types.RegisterSessionKey },
        primaryType: "RegisterSessionKey",
        message,
      });

      setRegStatus("Submitting to the JackTrade relayer…");
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
      if (!id) throw new Error("Relayer did not return an action id");

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
          abi: sessionKeyManagerAbi,
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
      setFinishErr(`Max margin per bet must be at least $${MIN_BALANCE} (the JackTrade minimum).`);
      return;
    }
    setFinishBusy(true);
    try {
      const res = await connectFinish(pending.pendingId, c);
      if (!res?.mcpUrl) throw new Error("Connector did not return an MCP URL");
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
      await ensureChain();
      const config = await getRelayerConfig();
      const skm = config.contracts.SessionKeyManager;
      const hash = await walletClient(account).writeContract({
        account,
        address: skm,
        abi: sessionKeyManagerAbi,
        functionName: "revokeSessionKey",
        args: [getAddress(revokeKey)],
      });
      setRevokeTx(hash);
      setRevokeMsg("Waiting for confirmation…");
      const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (r.status !== "success") throw new Error("Revoke transaction reverted");
      const still = await publicClient.readContract({
        address: skm,
        abi: sessionKeyManagerAbi,
        functionName: "isValidSessionKey",
        args: [account, getAddress(revokeKey)],
      });
      setRevokeMsg(still ? "Transaction landed but the key still reads as valid." : "Revoked. Grok can no longer trade for you.");
      if (!still) setRegistered(false);
    } catch (err) {
      setRevokeErr(errMsg(err));
      setRevokeMsg("");
    } finally {
      setRevokeBusy(false);
    }
  }

  const s1 = account && !wrongChain ? "done" : "active";
  const s2 = s1 !== "done" ? "todo" : account_ && !lowBalance ? "done" : "active";
  const s3 = s1 !== "done" ? "todo" : registered ? "done" : regErr ? "error" : "active";
  const s4 = !registered ? "todo" : mcpUrl ? "done" : "active";
  const s5 = mcpUrl ? "active" : "todo";

  return (
    <div className="page">
      <section className="hero">
        <h1>Read the news in Grok. Bet on it in the same chat.</h1>
        <p className="lead">
          Add JackTrade to Grok once. Then ask Grok what the news means for a market and tell it to bet. Grok
          checks the house, quotes the bet and places it onchain on Robinhood Chain.
        </p>
        <p className="safety">
          <span className="shield">🔒</span> Grok's key can open and close bets. It can never withdraw your money.
        </p>
      </section>

      <div className="steps">
        <Step n={1} title="Connect your wallet" state={s1}>
          {!hasWallet() ? (
            <p>
              No browser wallet found. Install{" "}
              <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                MetaMask
              </a>{" "}
              or Rabby, then reload.
            </p>
          ) : !account ? (
            <button className="btn" onClick={() => connect().catch(() => {})} disabled={walletBusy}>
              {walletBusy ? "Connecting…" : "Connect wallet"}
            </button>
          ) : wrongChain ? (
            <button className="btn btn-warn" onClick={switchChain}>
              Switch to Robinhood Chain
            </button>
          ) : (
            <p>
              Connected as <span className="mono">{short(account, 6)}</span> on Robinhood Chain.
            </p>
          )}
          <ErrorBox error={walletError} />
        </Step>

        <Step n={2} title="Check your JackTrade balance" state={s2}>
          {balance === null && !balanceErr && <p className="muted">Loading balance…</p>}
          {balance !== null && (
            <div className="stat-row">
              <div className="stat">
                <span className="stat-label">JackTrade balance</span>
                <span className="stat-value">{fmtUsd(balance)}</span>
              </div>
              {account_?.stats && (
                <div className="stat">
                  <span className="stat-label">Bets placed</span>
                  <span className="stat-value">{account_.stats.trades}</span>
                </div>
              )}
              <button className="btn btn-ghost btn-sm" onClick={loadBalance}>
                Refresh
              </button>
            </div>
          )}
          {lowBalance && (
            <div className="alert alert-warn">
              {balance === 0 ? "Your balance is empty." : `Bets need at least $${MIN_BALANCE} of margin.`} Deposit
              USDG on{" "}
              <a href={JACKTRADE_URL} target="_blank" rel="noreferrer">
                JackTrade
              </a>{" "}
              first, then hit Refresh. You can still connect Grok now.
            </div>
          )}
          <ErrorBox error={balanceErr} />
        </Step>

        <Step n={3} title="Approve Grok's trading key" state={s3}>
          <p>
            We create a dedicated key for Grok. You sign once (gasless) to register it with JackTrade's
            SessionKeyManager. The key can open and close bets for you. It can't withdraw.
          </p>
          {pending?.agentAddress && (
            <p className="kv">
              <span>Grok's key</span>
              <span className="mono">{short(pending.agentAddress, 6)}</span>
              {pending.expiry && (
                <>
                  <span>Expires</span>
                  <span>{new Date(Number(pending.expiry) * 1000).toLocaleString()}</span>
                </>
              )}
            </p>
          )}
          {!registered && (
            <button className="btn" onClick={registerKey} disabled={regBusy || s1 !== "done"}>
              {regBusy ? "Working…" : regErr ? "Try again" : "Approve Grok's key"}
            </button>
          )}
          {regStatus && <p className={registered ? "ok" : "muted"}>{regStatus}</p>}
          {regTx && (
            <p className="small">
              Relayer tx: <TxHash hash={regTx} />
            </p>
          )}
          <ErrorBox error={regErr} />
        </Step>

        <Step n={4} title="Set Grok's limits" state={s4}>
          <p className="muted">The connector enforces these on every bet Grok places.</p>
          <form className="caps" onSubmit={finish}>
            <label>
              <span>Max margin per bet (USD)</span>
              <input
                type="number"
                min="10"
                step="1"
                value={caps.maxMarginUsd}
                onChange={(e) => setCaps({ ...caps, maxMarginUsd: e.target.value })}
                disabled={!!mcpUrl}
              />
            </label>
            <label>
              <span>Max leverage (×)</span>
              <input
                type="number"
                min="1"
                step="1"
                value={caps.maxLeverage}
                onChange={(e) => setCaps({ ...caps, maxLeverage: e.target.value })}
                disabled={!!mcpUrl}
              />
            </label>
            <label>
              <span>Daily loss limit (USD)</span>
              <input
                type="number"
                min="1"
                step="1"
                value={caps.dailyLossUsd}
                onChange={(e) => setCaps({ ...caps, dailyLossUsd: e.target.value })}
                disabled={!!mcpUrl}
              />
            </label>
            {!mcpUrl && (
              <button className="btn" type="submit" disabled={finishBusy || !registered}>
                {finishBusy ? "Saving…" : "Save limits and get my Grok link"}
              </button>
            )}
          </form>
          <ErrorBox error={finishErr} />
        </Step>

        <Step n={5} title="Add JackTrade to Grok" state={s5}>
          <p>Your private connector URL. Treat it like a password: anyone with it can trade with Grok's key.</p>
          <div className="copy-row">
            <code className="mcp-url selectable">{mcpUrl}</code>
            <CopyButton text={mcpUrl} label="Copy URL" />
          </div>
          <ol className="howto">
            <li>
              Open{" "}
              <a href="https://grok.com/connectors" target="_blank" rel="noreferrer">
                grok.com/connectors
              </a>{" "}
              (grok.com → Connectors).
            </li>
            <li>
              Click <b>New Connector</b>, then <b>Custom</b>.
            </li>
            <li>Paste the URL above, name it "JackTrade" and save.</li>
            <li>
              In a new Grok chat, try: <i>"What does today's news mean for BTC? If you agree, bet $20 long at 50x."</i>
            </li>
          </ol>
          <p>
            Bets Grok places show up in the <Link to="/bets">Grok bets feed</Link>.
          </p>
        </Step>
      </div>

      {account && (
        <section className="card revoke">
          <h3>Revoke Grok's key</h3>
          <p className="muted">
            Sends <span className="mono">revokeSessionKey</span> to JackTrade's SessionKeyManager from your wallet
            (needs a little ETH for gas). Grok stops being able to trade immediately.
          </p>
          <div className="copy-row">
            <input
              className="mono"
              placeholder="Grok's key address 0x…"
              value={revokeKey}
              onChange={(e) => setRevokeKey(e.target.value.trim())}
            />
            <button className="btn btn-danger" onClick={revoke} disabled={revokeBusy}>
              {revokeBusy ? "Revoking…" : "Revoke"}
            </button>
          </div>
          {revokeTx && (
            <p className="small">
              Tx: <TxHash hash={revokeTx} />
            </p>
          )}
          {revokeMsg && <p className="ok">{revokeMsg}</p>}
          <ErrorBox error={revokeErr} />
        </section>
      )}
    </div>
  );
}
