import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LEVERAGE, liquidationPrice } from "@/lib/protocolModel";
import { orderMinimumIssue } from "@/lib/orderMinimums";
import {
  switchToRobinhood,
  clearSessionKey,
  closePosition as closeRemotePosition,
  connectInjectedWallet,
  depositWithPermit,
  fetchProtocolData,
  fetchPreview,
  isValidSessionKey,
  loadConfig,
  openPosition as openRemotePosition,
  readStoredSessionKey,
  registerSession,
  revokeSession,
  submitWalletAction,
  parseUnits,
} from "@/lib/jacktradeClient";

/**
 * Polls a read-only API call while `key` stays the same (null pauses it). Data from an older key is never shown.
 * `retry()` runs it again right away, for error states.
 */
/**
 * Calls `fn` every `interval` ms without overlapping calls, skips ticks while the tab is hidden and backs off after
 * errors (up to a minute), so many open tabs or a struggling API don't snowball. Returns a stop function.
 */
export function pollLoop(fn, interval) {
  let stopped = false;
  let timer;
  let failures = 0;
  const run = async () => {
    if (stopped) return;
    if (typeof document === "undefined" || !document.hidden) {
      try { await fn(); failures = 0; } catch { failures += 1; }
    }
    if (!stopped) timer = setTimeout(run, Math.min(60_000, interval * 2 ** Math.min(failures, 4)));
  };
  const wake = () => { if (!document.hidden && !stopped) { clearTimeout(timer); run(); } };
  run();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", wake);
  return () => { stopped = true; clearTimeout(timer); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", wake); };
}

export function usePolledData(key, load, interval = 15_000) {
  const loader = useRef(load);
  useEffect(() => { loader.current = load; });
  const [state, setState] = useState({ key: null, data: null, error: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (key == null) return;
    let stopped = false;
    const tick = () => loader.current()
      .then((data) => { if (!stopped) setState({ key, data, error: "" }); })
      .catch((reason) => {
        if (!stopped) setState((current) => ({ key, data: current.key === key ? current.data : null, error: reason?.message || "Request failed." }));
        throw reason; // lets the loop back off
      });
    const stop = pollLoop(tick, interval);
    return () => { stopped = true; stop(); };
  }, [key, interval, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const fresh = state.key === key;
  return { data: fresh ? state.data : null, error: fresh ? state.error : "", loading: key != null && !fresh, retry };
}

const PREFS_KEY = "hm.production.preferences.v1";
const EMPTY = {
  balance: 0, positions: [], history: [], queue: [], queueHistory: [], events: [], equity: [], analytics: [],
  token: 0, minted: 0, staked: 0, claimable: 0, claimed: 0, credited: 0, lp: 0,
  walletBalance: 0,
  sessionUntil: 0, sessionStarted: 0,
  pauseUntil: 0,
};

function preferences() {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(PREFS_KEY)) }; }
  catch { return EMPTY; }
}

function symbolFor(position) {
  if (position.instrumentId === 0 || position.market?.startsWith("BTC")) return "BTC-PERP";
  if (position.instrumentId === 1 || position.market?.startsWith("ETH")) return "ETH-PERP";
  return position.market?.replace("/USD", "-PERP") ?? `MARKET-${position.instrumentId}`;
}

function mapPosition(position) {
  const margin = Number(position.margin);
  const leverage = Number(position.leverage);
  return {
    id: String(position.id), symbol: symbolFor(position), side: position.side,
    margin, leverage, notional: margin * leverage, entry: Number(position.entryPrice),
    liq: Number(position.liquidationPrice), mark: position.markPrice == null ? null : Number(position.markPrice),
    pnl: position.pnl == null ? 0 : Number(position.pnl), time: Number(position.openedAt) * 1000,
    liquidatable: position.liquidatable ?? null,
  };
}

function mapHistory(item) {
  const isTrade = item.type === "close" || item.type === "liquidation";
  return {
    ...item, id: String(item.id ?? item.tx ?? `${item.type}-${item.at}`),
    symbol: isTrade ? symbolFor(item) : undefined, side: item.side,
    margin: Number(item.margin ?? item.amount ?? 0), leverage: Number(item.leverage ?? 0),
    notional: Number(item.margin ?? 0) * Number(item.leverage ?? 0), entry: Number(item.entryPrice ?? 0),
    exit: Number(item.exitPrice ?? 0), pnl: Number(item.pnl ?? 0), fee: Number(item.fee ?? 0),
    liquidated: item.type === "liquidation", reason: item.type, time: Number(item.at) * 1000,
    duration: Math.max(0, Number(item.at ?? 0) - Number(item.openedAt ?? item.at ?? 0)) * 1000,
  };
}

// A rejected signature reads as such, not as viem's technical message.
const walletErrorMessage = (reason) => (reason?.code === 4001 || reason?.name === "UserRejectedRequestError" || reason?.cause?.code === 4001 ? "Signature cancelled in your wallet." : reason?.message || "Something went wrong.");

export function useBackendAccount(quotes) {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState("");
  const [wallet, setWallet] = useState(null);
  const [session, setSession] = useState(null);
  const [remote, setRemote] = useState(null);
  const [prefs, setPrefs] = useState(preferences);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);
  // Config again every minute: markets get listed, limits and the pause change on-chain. A failed reload keeps the last good
  // config (it only shows an error if there was never one).
  useEffect(() => pollLoop(() => loadConfig()
    .then((value) => { if (mounted.current) { setConfig(value); setConfigError(""); } })
    .catch((reason) => { if (mounted.current) setConfigError(reason.message); throw reason; }), 60_000), []);

  const refresh = useCallback(async (activeWallet = wallet, activeConfig = config) => {
    if (!activeWallet?.user || !activeConfig) return null;
    const data = await fetchProtocolData(activeConfig, activeWallet.user);
    if (mounted.current) setRemote(data);
    return data;
  }, [wallet, config]);

  useEffect(() => {
    if (!wallet?.user || !config) return;
    // Every 4 s, never overlapping; an error is shown (stale numbers are not passed off as current) and cleared on success.
    return pollLoop(() => refresh()
      .then(() => { if (mounted.current) setError((e) => (e.startsWith("Account data is out of date") ? "" : e)); })
      .catch((reason) => { if (mounted.current) setError(`Account data is out of date: ${reason.message}`); throw reason; }), 4_000);
  }, [wallet?.user, config, refresh]);

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* Preferences are optional. */ }
  }, [prefs]);

  const connect = useCallback(async (provider) => {
    if (!config) throw new Error(configError || "Protocol configuration is still loading.");
    setStatus("connecting"); setError("");
    try {
      const next = await connectInjectedWallet(config, provider);
      setWallet(next);
      setStatus("ready");
      const stored = readStoredSessionKey(next.user);
      const validation = stored && stored.expiry * 1000 > Date.now()
        ? isValidSessionKey(config, next.user, stored.address)
        : Promise.resolve(false);
      void validation.then((valid) => {
        if (!mounted.current) return;
        if (valid) setSession(stored);
        else { clearSessionKey(next.user); setSession(null); }
      }).catch((reason) => {
        if (!mounted.current) return;
        setError(reason.message);
      });
      return next;
    } catch (reason) { setStatus("error"); setError(reason.message); throw reason; }
  }, [config, configError]);

  useEffect(() => {
    const provider = wallet?.provider ?? window.ethereum;
    if (!provider?.on) return;
    // Another account logs out. Another chain doesn't: every signature switches back to Robinhood Chain first, and a
    // phone wallet over WalletConnect often reports its own default chain right after connecting.
    const accounts = () => { setWallet(null); setSession(null); setRemote(null); };
    provider.on("accountsChanged", accounts);
    return () => { provider.removeListener?.("accountsChanged", accounts); };
  }, [wallet?.provider]);

  const enableSession = useCallback(async () => {
    // A valid key for this wallet already exists: don't register another one (each one stays valid until it expires).
    if (wallet && session && session.expiry * 1000 > Date.now() + 60_000) return session;
    const active = wallet ?? await connect();
    setStatus("signing"); setError("");
    try {
      if (active.provider) await switchToRobinhood(active.provider, config?.chainId);
      const next = await registerSession(config, active.walletClient, active.user, setStatus);
      setSession(next); setStatus("ready"); return next;
    } catch (reason) { setStatus("error"); setError(reason.message); throw reason; }
  }, [wallet, session, connect, config]);

  const run = useCallback(async (work) => {
    setStatus("signing"); setError("");
    // Signatures are for Robinhood Chain: a wallet left on another chain (after a cross-chain deposit) switches back.
    // The refresh after a trade runs in the background: the result is back as soon as the relayer confirms it.
    try { if (wallet?.provider) await switchToRobinhood(wallet.provider, config?.chainId); const result = await work(setStatus); void refresh().catch(() => {}); setStatus("ready"); return { ok: true, result }; }
    catch (reason) { const message = walletErrorMessage(reason); setStatus("error"); setError(message); return { ok: false, error: message, code: reason.code }; }
  }, [refresh, wallet, config]);

  // The trade is executed on-chain before the indexer has it: refresh a few times so the position shows up (or goes
  // away) right after, instead of the balance changing with no position for several seconds.
  const settle = useCallback(async (done) => {
    for (let i = 0; i < 16; i++) {
      const data = await refresh().catch(() => null);
      if (data && done(data)) return;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }, [refresh]);

  // Trades the relayer confirmed that the indexer hasn't caught up with yet (a second or so): shown right away.
  const [optimistic, setOptimistic] = useState({ opened: [], closed: [] });
  const positions = useMemo(() => {
    const indexed = remote?.positions.map(mapPosition) ?? [];
    const ids = new Set(indexed.map((p) => p.id));
    return [...optimistic.opened.filter((p) => !ids.has(p.id)), ...indexed.filter((p) => !optimistic.closed.includes(p.id))];
  }, [remote, optimistic]);
  // Drop each optimistic entry once the indexer agrees (or after 20 s, whatever the indexer says).
  useEffect(() => {
    if (!remote) return;
    const ids = new Set(remote.positions.map((p) => String(p.id)));
    const fresh = (p) => Date.now() - p.since < 20_000;
    setOptimistic((o) => {
      const opened = o.opened.filter((p) => !ids.has(p.id) && fresh(p));
      const closed = o.closed.filter((id) => ids.has(id) && fresh(o.closedSince?.[id] ?? { since: 0 }));
      return opened.length === o.opened.length && closed.length === o.closed.length ? o : { ...o, opened, closed };
    });
  }, [remote]);
  const history = useMemo(() => remote?.history.map(mapHistory) ?? [], [remote]);
  const balance = Number(remote?.account.balance ?? 0);
  const usedMargin = positions.reduce((sum, item) => sum + item.margin, 0);
  const unrealizedPnL = positions.reduce((sum, item) => sum + Number(item.pnl || 0), 0);
  // The wallet's unpaid profit in the FIFO queue (GET /api/account): one line with its place and what is ahead of it.
  // Individual queued/paid events come from fetchActivity({ user, kind: "queue" }).
  const queue = useMemo(() => {
    const waiting = remote?.account.queue;
    return waiting ? [{ id: `queue-${remote.account.user}`, amount: Number(waiting.waiting), position: waiting.position, ahead: Number(waiting.ahead) }] : [];
  }, [remote]);
  const sessionUntil = session?.expiry ? session.expiry * 1000 : 0;

  const update = useCallback((fn) => setPrefs((current) => fn(current)), []);
  const account = useMemo(() => ({
    ...EMPTY, ...prefs, balance, positions, history, queue,
    token: Number(remote?.token ?? 0), minted: Number(remote?.account.stats.minted ?? 0), staked: Number(remote?.staked ?? 0),
    claimable: Number(remote?.claimable ?? 0), claimed: Number(remote?.account.staking?.claimed ?? 0), credited: Number(remote?.account.staking?.credited ?? 0), lp: Number(remote?.stats?.bankroll ?? 0),
    sessionUntil, sessionStarted: sessionUntil ? sessionUntil - config?.limits.sessionKeyMaxDuration * 1000 : 0,
    // The connected wallet's client, for signatures outside the relayer flow (profile username).
    walletClient: wallet?.walletClient ?? null,
    walletProvider: wallet?.provider ?? null,
    availableMargin: balance, walletBalance: Number(remote?.walletCollateral ?? 0), activated: remote?.activated ?? null, usedMargin, unrealizedPnL, totalEquity: balance + usedMargin + unrealizedPnL,
    protocol: { config, configError, status, error, wallet: wallet?.user ?? null, connected: !!wallet, sessionReady: sessionUntil > Date.now(), markets: remote?.markets ?? [], stats: remote?.stats ?? null, rate: remote?.rate ?? null },
    update,
    connect,
    enableSession,
    revokeSession: () => {
      if (!wallet || !session) return Promise.resolve({ ok: false, error: "No active session to revoke." });
      return run(() => revokeSession(config, wallet.walletClient, wallet.user, session.address)).then((result) => { if (result.ok) setSession(null); return result; });
    },
    refresh,
    previewPosition: (id) => fetchPreview(id),
    openPosition: (order) => {
      if (!wallet || !session) return Promise.resolve({ ok: false, error: "Connect your wallet and enable the trading session first." });
      const market = config.markets.find((item) => item.id === ({ "BTC-PERP": 0, "ETH-PERP": 1 })[order.symbol]);
      if (!market?.listed) return Promise.resolve({ ok: false, error: "This market is not listed yet." });
      if (!Number.isInteger(order.leverage) || order.leverage < LEVERAGE.min || order.leverage > market.maxLeverage || order.leverage % LEVERAGE.step !== 0) return Promise.resolve({ ok: false, error: `Leverage must be between ${LEVERAGE.min}× and ${market.maxLeverage}× in ${LEVERAGE.step}× steps.` });
      const minimumIssue = orderMinimumIssue(order.margin, order.leverage, market);
      if (minimumIssue?.kind === "margin") return Promise.resolve({ ok: false, error: `Minimum margin is ${minimumIssue.minimum} USDG.` });
      if (minimumIssue?.kind === "position") return Promise.resolve({ ok: false, error: `Minimum position size is ${minimumIssue.minimum} USDG.` });
      const notional = order.margin * order.leverage;
      if (notional > Number(market.maxNotional)) return Promise.resolve({ ok: false, error: `Position size cannot exceed ${market.maxNotional} USDG.` });
      const quote = quotes[order.symbol];
      if (!quote || Date.now() / 1000 - quote.publishTime > 5) return Promise.resolve({ ok: false, error: "The price is stale. Wait for a fresh quote." });
      if ((Number(quote.conf) / Number(quote.price)) * 10_000 > market.maxConfBps) return Promise.resolve({ ok: false, error: "Price confidence is too wide. Wait a few seconds." });
      return run((onStatus) => openRemotePosition(config, { user: wallet.user, privateKey: session.privateKey, instrumentId: market.id, isLong: order.side === "long", margin: parseUnits(String(order.margin), config.collateral.decimals), leverage: order.leverage, quote: quotes[order.symbol], onStatus }))
        .then((result) => {
          const status = result.result;
          if (result.ok && status?.positionId != null) {
            const entry = Number(status.price) / 1e18;
            const buffer = remote?.markets?.find((m) => m.instrumentId === market.id)?.liqBufferBps;
            setOptimistic((o) => ({ ...o, opened: [...o.opened, { id: String(status.positionId), symbol: order.symbol, side: order.side, margin: order.margin, leverage: order.leverage, notional: order.margin * order.leverage, entry, liq: liquidationPrice(order.side, entry, order.leverage, buffer), mark: entry, pnl: 0, time: Date.now(), liquidatable: false, pending: true, since: Date.now() }] }));
          }
          if (result.ok) void settle((data) => data.positions.some((p) => String(p.id) === String(status?.positionId)));
          return result;
        });
    },
    closePosition: (id) => {
      const position = positions.find((item) => item.id === String(id));
      if (!wallet || !session || !position) return Promise.resolve({ ok: false, error: "Position or active session not found." });
      return run((onStatus) => closeRemotePosition(config, { user: wallet.user, privateKey: session.privateKey, positionId: id, isLong: position.side === "long", quote: quotes[position.symbol], onStatus }))
        .then((result) => {
          if (result.ok) {
            setOptimistic((o) => ({ ...o, closed: [...o.closed, String(id)], closedSince: { ...o.closedSince, [String(id)]: { since: Date.now() } } }));
            void settle((data) => !data.positions.some((p) => String(p.id) === String(id)));
          }
          return result;
        });
    },
    transfer: (amount, withdraw) => {
      if (!wallet) return Promise.resolve({ ok: false, error: "Connect your wallet first." });
      return run((onStatus) => withdraw
        ? submitWalletAction(config, wallet.walletClient, wallet.user, "withdraw", { to: wallet.user, amount: parseUnits(String(amount), config.collateral.decimals) }, onStatus)
        : depositWithPermit(config, wallet.walletClient, wallet.user, amount, onStatus));
    },
    stake: (amount, withdraw) => {
      if (!wallet) return Promise.resolve({ ok: false, error: "Connect your wallet first." });
      return run((onStatus) => submitWalletAction(config, wallet.walletClient, wallet.user, withdraw ? "unstake" : "stake", { amount: parseUnits(String(amount), config.token.decimals) }, onStatus));
    },
    claim: () => wallet ? run((onStatus) => submitWalletAction(config, wallet.walletClient, wallet.user, "claim", {}, onStatus)) : Promise.resolve({ ok: false, error: "Connect your wallet first." }),
    // Disconnect forgets this device's session key too: whoever uses the browser next can't trade with it.
    reset: () => { if (wallet?.user) clearSessionKey(wallet.user); setSession(null); setWallet(null); setRemote(null); },
  }), [prefs, balance, positions, history, queue, remote, sessionUntil, config, configError, status, error, wallet, update, connect, enableSession, refresh, usedMargin, unrealizedPnL, session, quotes, run, settle]);

  return { account, connected: !!wallet, user: wallet?.user ?? null };
}
