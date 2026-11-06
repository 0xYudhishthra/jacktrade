// Hackathon addition (ETHGlobal Mumbai 2026): Connect Grok.
// Wallet → approve Grok's trading key (gasless RegisterSessionKey through the relayer's /action) → set caps →
// copy the private MCP connector URL into grok.com. The key can open and close bets; it can never withdraw.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getAddress, isAddress } from "viem";
import { Shell, Panel } from "@/components/product/ProductUI";
import { submitWalletAction } from "@/lib/jacktradeClient";
import { connectFinish, connectStart } from "@/lib/grok/api";
import { SESSION_KEY_MANAGER_ABI } from "@/lib/grok/config";
import { ensureChain, errMsg, publicClient, useGrokWallet } from "@/lib/grok/wallet";
import { CopyButton, ErrorBox, Note, Step, TxHash, fmtUsd, short } from "@/components/grok/GrokUI";

const MIN_BALANCE = 10; // market minMargin is 10 USDG
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    /* optional */
  }
}

const RELAYER_STATUS = {
  queued: "Relayer: queued…",
  submitted: "Relayer: submitted onchain…",
  executed: "Relayer: executed.",
};

export default function GrokConnectPage() {
  const w = useGrokWallet();
  const account = w.address;
  const config = w.config;

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

  // Reset when the wallet changes.
  useEffect(() => {
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

  const balance = account ? Number(w.balance ?? 0) : null;
  const lowBalance = balance !== null && balance < MIN_BALANCE;

  async function registerKey() {
    setRegErr("");
    setRegBusy(true);
    setRegistered(false);
    setRegTx(null);
    try {
      if (!config) throw new Error("The exchange config is still loading. Try again in a moment.");
      await ensureChain(w);
      setRegStatus("Creating Grok's trading key…");
      const start = await connectStart(account);
      if (!start?.pendingId || !isAddress(start?.agentAddress || "")) {
        throw new Error("Connector returned an unexpected response for /api/connect/start");
      }
      setPending(start);
      const agentAddress = getAddress(start.agentAddress);
      saveAgent(account, { agentAddress });
      setRevokeKey(agentAddress);

      const skm = config.contracts.SessionKeyManager;
      // The signature is bound to the current epoch: revokeAllSessionKeys bumps it.
      const epoch = await publicClient.readContract({
        address: skm,
        abi: SESSION_KEY_MANAGER_ABI,
        functionName: "epochOf",
        args: [account],
      });

      setRegStatus("Sign in your wallet to approve Grok's key (no gas)…");
      // Same gasless path as the exchange's one-click trading: EIP-712 RegisterSessionKey → relayer POST /action.
      const result = await submitWalletAction(
        config,
        w.walletClient,
        account,
        "registerSessionKey",
        { key: agentAddress, expiry: BigInt(start.expiry), epoch },
        (status) => setRegStatus(RELAYER_STATUS[status] || `Relayer: ${status || "working"}…`),
      );
      const tx = result?.txHash || result?.hash || result?.result?.txHash || null;
      if (tx) setRegTx(tx);

      setRegStatus("Checking the key onchain…");
      let valid = false;
      for (let i = 0; i < 6 && !valid; i++) {
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
      if (!config) throw new Error("The exchange config is still loading. Try again in a moment.");
      await ensureChain(w);
      const skm = config.contracts.SessionKeyManager;
      // Revokes only Grok's key: the browser's own one-click trading key is left alone.
      const hash = await w.walletClient.writeContract({
        account,
        address: skm,
        abi: SESSION_KEY_MANAGER_ABI,
        functionName: "revokeSessionKey",
        args: [getAddress(revokeKey)],
      });
      setRevokeTx(hash);
      setRevokeMsg("Waiting for confirmation…");
      const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (r.status !== "success") throw new Error("Revoke transaction reverted");
      const still = await publicClient.readContract({
        address: skm,
        abi: SESSION_KEY_MANAGER_ABI,
        functionName: "isValidSessionKey",
        args: [account, getAddress(revokeKey)],
      });
      setRevokeMsg(
        still ? "Transaction landed but the key still reads as valid." : "Revoked. Grok can no longer trade for you.",
      );
      if (!still) setRegistered(false);
    } catch (err) {
      setRevokeErr(errMsg(err));
      setRevokeMsg("");
    } finally {
      setRevokeBusy(false);
    }
  }

  const s1 = account ? "done" : "active";
  const s2 = s1 !== "done" ? "todo" : !lowBalance ? "done" : "active";
  const s3 = s1 !== "done" ? "todo" : registered ? "done" : regErr ? "error" : "active";
  const s4 = !registered ? "todo" : mcpUrl ? "done" : "active";
  const s5 = mcpUrl ? "active" : "todo";

  return (
    <Shell
      title="Connect Grok"
      kicker="JACKTRADE / GROK"
      subtitle="Read the news in Grok. Bet on it in the same chat. Add JackTrade to Grok once, then ask what the news means for a market and tell it to bet: Grok checks the house, quotes the bet and places it onchain."
      action={
        <Link to="/grok/bets" className="luna-btn">
          Grok bets ↗
        </Link>
      }
    >
      <div className="jt-grok">
        <Note tone="ok">
          <span className="jt-safety">Grok&apos;s key can open and close bets. It can never withdraw your money.</span>{" "}
          You set its limits, and you can revoke it any time.
        </Note>

        <Step n={1} title="Connect your wallet" state={s1}>
          {!account ? (
            <button className="luna-btn luna-btn-active" onClick={w.connect}>
              Connect wallet
            </button>
          ) : (
            <p>
              Connected as <span className="jt-mono">{short(account, 6)}</span> on Robinhood Chain.
            </p>
          )}
        </Step>

        <Step n={2} title="Check your JackTrade balance" state={s2}>
          <div className="jt-row">
            <span>
              Trading balance: <strong>{fmtUsd(balance)}</strong>
            </span>
            <button className="luna-btn" onClick={w.deposit}>
              Deposit
            </button>
          </div>
          {lowBalance && (
            <Note>
              {balance === 0 ? "Your balance is empty." : `Bets need at least $${MIN_BALANCE} of margin.`} Deposit
              USDG first. You can still connect Grok now.
            </Note>
          )}
        </Step>

        <Step n={3} title="Approve Grok's trading key" state={s3}>
          <p>
            We create a dedicated key for Grok. You sign once (gasless) to register it with JackTrade&apos;s
            SessionKeyManager. The key can open and close bets for you. It can&apos;t withdraw.
          </p>
          {pending?.agentAddress && (
            <p className="jt-small">
              Grok&apos;s key <span className="jt-mono">{short(pending.agentAddress, 6)}</span>
              {pending.expiry && <> · expires {new Date(Number(pending.expiry) * 1000).toLocaleString()}</>}
            </p>
          )}
          {!registered && (
            <button className="luna-btn luna-btn-active" onClick={registerKey} disabled={regBusy || s1 !== "done"}>
              {regBusy ? "Working…" : regErr ? "Try again" : "Approve Grok's key"}
            </button>
          )}
          {regStatus && <p className={registered ? "jt-ok" : "jt-muted"}>{regStatus}</p>}
          {regTx && (
            <p className="jt-small">
              Relayer tx: <TxHash hash={regTx} />
            </p>
          )}
          <ErrorBox error={regErr} />
        </Step>

        <Step n={4} title="Set Grok's limits" state={s4}>
          <p className="jt-muted">The connector enforces these on every bet Grok places.</p>
          <form className="jt-form" onSubmit={finish}>
            <label className="pm-field">
              Max margin per bet (USD)
              <input
                type="number"
                min="10"
                step="1"
                value={caps.maxMarginUsd}
                onChange={(e) => setCaps({ ...caps, maxMarginUsd: e.target.value })}
                disabled={!!mcpUrl}
              />
            </label>
            <label className="pm-field">
              Max leverage (×)
              <input
                type="number"
                min="1"
                step="1"
                value={caps.maxLeverage}
                onChange={(e) => setCaps({ ...caps, maxLeverage: e.target.value })}
                disabled={!!mcpUrl}
              />
            </label>
            <label className="pm-field">
              Daily loss limit (USD)
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
              <button className="luna-btn luna-btn-active" type="submit" disabled={finishBusy || !registered}>
                {finishBusy ? "Saving…" : "Save limits and get my Grok link"}
              </button>
            )}
          </form>
          <ErrorBox error={finishErr} />
        </Step>

        <Step n={5} title="Add JackTrade to Grok" state={s5}>
          <p>Your private connector URL. Treat it like a password: anyone with it can trade with Grok&apos;s key.</p>
          <div className="jt-copy">
            <code className="jt-selectable">{mcpUrl}</code>
            <CopyButton text={mcpUrl} label="Copy URL" />
          </div>
          <ol className="jt-howto">
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
            <li>Paste the URL above, name it &quot;JackTrade&quot; and save.</li>
            <li>
              In a new Grok chat, try: <i>&quot;What does today&apos;s news mean for BTC? If you agree, bet $20 long at
              50x.&quot;</i>
            </li>
          </ol>
          <p>
            Bets Grok places show up in the <Link to="/grok/bets">Grok bets feed</Link> and in your{" "}
            <Link to="/portfolio">portfolio</Link>.
          </p>
        </Step>

        {account && (
          <Panel title="Revoke Grok's key">
            <p className="jt-muted">
              Sends <span className="jt-mono">revokeSessionKey</span> to JackTrade&apos;s SessionKeyManager from your
              wallet (needs a little ETH for gas). Grok stops being able to trade immediately.
            </p>
            <div className="jt-copy">
              <input
                placeholder="Grok's key address 0x…"
                value={revokeKey}
                onChange={(e) => setRevokeKey(e.target.value.trim())}
              />
              <button className="luna-btn" onClick={revoke} disabled={revokeBusy}>
                {revokeBusy ? "Revoking…" : "Revoke"}
              </button>
            </div>
            {revokeTx && (
              <p className="jt-small">
                Tx: <TxHash hash={revokeTx} />
              </p>
            )}
            {revokeMsg && <p className="jt-ok">{revokeMsg}</p>}
            <ErrorBox error={revokeErr} />
          </Panel>
        )}
      </div>
    </Shell>
  );
}
