import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  currentAccount,
  ensureChain,
  errMsg,
  hasWallet,
  onWalletChange,
  requestAccount,
} from "../lib/wallet.js";
import { CHAIN_ID } from "../lib/config.js";
import { short } from "../lib/chain.js";

const Ctx = createContext(null);

export function WalletProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setAccount(await currentAccount());
    if (hasWallet()) {
      try {
        setChainId(parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16));
      } catch {
        setChainId(null);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
    return onWalletChange(refresh);
  }, [refresh]);

  const connect = useCallback(async () => {
    setError("");
    setBusy(true);
    try {
      const a = await requestAccount();
      await ensureChain();
      setAccount(a);
      await refresh();
      return a;
    } catch (err) {
      setError(errMsg(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const switchChain = useCallback(async () => {
    setError("");
    try {
      await ensureChain();
      await refresh();
    } catch (err) {
      setError(errMsg(err));
    }
  }, [refresh]);

  return (
    <Ctx.Provider
      value={{ account, chainId, wrongChain: !!account && chainId !== CHAIN_ID, connect, switchChain, error, busy }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  return useContext(Ctx);
}

export function WalletButton() {
  const { account, wrongChain, connect, switchChain, busy } = useWallet();
  if (!hasWallet()) {
    return (
      <a className="btn btn-ghost btn-sm" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
        Get a wallet
      </a>
    );
  }
  if (!account) {
    return (
      <button className="btn btn-sm" onClick={() => connect().catch(() => {})} disabled={busy}>
        {busy ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }
  if (wrongChain) {
    return (
      <button className="btn btn-warn btn-sm" onClick={switchChain}>
        Switch to Robinhood Chain
      </button>
    );
  }
  return (
    <span className="pill pill-wallet" title={account}>
      <span className="dot" /> {short(account)}
    </span>
  );
}
