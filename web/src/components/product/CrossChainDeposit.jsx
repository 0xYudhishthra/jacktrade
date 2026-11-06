import { useEffect, useMemo, useRef, useState } from "react";
import { Trustware } from "@trustware/sdk";
import { useEIP1193 as eip1193Wallet } from "@trustware/sdk/wallet";
import { Check, ChevronLeft, Loader2 } from "lucide-react";
import { encodeFunctionData, formatUnits, parseAbi, parseUnits } from "viem";
import { TRUSTED, switchToRobinhood } from "@/lib/jacktradeClient";
import { money } from "@/lib/protocolModel";
// Main assets per chain (native, USDC, USDT, DAI, WETH, WBTC…) from Trustware's token catalog. Wallets also hold
// spam tokens, some named "USDC": only these are listed.
import ASSETS from "@/lib/depositAssets.json";

// Deposit from any chain, built on Trustware's headless core: the wallet's holdings on every chain are scanned, the
// user picks one, and the route delivers USDG on Robinhood Chain to the same wallet. The Exchange deposit stays our own
// signed flow afterwards. Loaded on demand: the SDK is large.
export const TRUSTWARE_API_KEY = import.meta.env?.VITE_TRUSTWARE_API_KEY ?? "";
const API = "https://api.trustware.io/api/v1";
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const MIN_USD = 1; // dust is not worth a route
// Straight into the Exchange: the bridge's executor approves USDG to the Exchange and calls depositFor(user, amount)
// with the amount that actually landed (patched by the provider). If the call can't run, the USDG go to the wallet.
const DEPOSIT_FOR = parseAbi(["function depositFor(address user, uint256 amount)"]);
const directDepositHook = (user) => ({
  postHook: {
    target: TRUSTED.Exchange,
    callData: encodeFunctionData({ abi: DEPOSIT_FOR, functionName: "depositFor", args: [user, 0n] }),
    fundToken: TRUSTED.collateral,
    fullAmount: true,
    amountInputPos: 1,
    toApprovalAddress: TRUSTED.Exchange,
    estimatedGas: "250000",
    toFallbackAddress: user,
  },
});
// Sent from another chain, the deposit must still land at or above the Exchange minimum after fees and 1% slippage.
const MIN_CROSS_CHAIN_USD = 12;
const SLIPPAGE = 1; // percent

let ready = null;
const init = () => (ready ??= Trustware.init({
  apiKey: TRUSTWARE_API_KEY,
  routes: { toChain: String(TRUSTED.chainId), toToken: TRUSTED.collateral, defaultSlippage: SLIPPAGE },
}));

let chainsRequest = null;
const loadChains = () => (chainsRequest ??= fetch(`${API}/routes/chains`)
  .then((r) => r.json())
  .then((body) => Object.fromEntries((body.data ?? []).map((c) => [String(c.chainId), { name: c.networkName || c.chainName, icon: c.chainIconURI, type: c.chainType || c.type }])))
  .catch(() => ({})));

const tokenAddress = (row) => (row.category === "native" ? NATIVE : row.contract || row.address)?.toLowerCase();
const isOurUsdg = (chainId, row) => chainId === String(TRUSTED.chainId) && tokenAddress(row) === TRUSTED.collateral.toLowerCase();
const STABLE = new Set(["USDC", "USDT", "USDT0", "DAI", "PYUSD", "USDC.E", "USDG", "XDAI"]);

/** Listed holdings (allowlisted assets only), USD from `prices`; USDG already on Robinhood Chain is the other option. */
function holdingsFrom(results, prices) {
  return results
    .flatMap((r) => (r.balances ?? []).map((row) => ({ ...row, chainId: String(r.chain_id) })))
    .map((row) => ({ row, asset: ASSETS[row.chainId]?.[tokenAddress(row)] }))
    .filter(({ row, asset }) => asset && BigInt(row.balance || "0") > 0n && !isOurUsdg(row.chainId, row))
    .map(({ row, asset }) => {
      const amount = Number(formatUnits(BigInt(row.balance), row.decimals ?? asset.decimals));
      const key = `${row.chainId}:${tokenAddress(row)}`;
      const price = STABLE.has(asset.symbol.toUpperCase()) ? 1 : prices[key];
      return { ...row, symbol: asset.symbol, logoURI: asset.logo || row.logoURI, decimals: row.decimals ?? asset.decimals, amount, price, usd: price == null ? null : amount * price, key };
    })
    .filter((row) => row.usd == null || row.usd >= MIN_USD)
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
}

/** USD price of one listed token, from Trustware's catalog (searched by symbol on its chain). */
async function priceOf(chainId, address, symbol) {
  const res = await fetch(`${API}/routes/tokens?chainId=${chainId}&q=${encodeURIComponent(symbol)}&limit=20`);
  const body = await res.json();
  const rows = body.data?.items ?? body.data ?? body.items ?? [];
  const hit = (Array.isArray(rows) ? rows : []).find((t) => t.address?.toLowerCase() === address);
  return hit?.usdPrice ?? null;
}

export default function CrossChainDeposit({ provider, address, walletBalance = 0, exchangeBalance = 0, minimumUsdg = 11, onExit, onSent, onArrived, onDeposit, onDone, onError }) {
  // The route switches the wallet to the source chain: afterwards it goes back to Robinhood Chain for the deposit.
  useEffect(() => () => { void switchToRobinhood(provider).catch(() => {}); }, [provider]);
  const callbacks = useRef({ onSent, onArrived, onError });
  useEffect(() => { callbacks.current = { onSent, onArrived, onError }; });

  const [chains, setChains] = useState({});
  const [scan, setScan] = useState({ results: new Map(), done: false, completed: 0, total: 0 });
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    (async () => {
      const [meta] = await Promise.all([loadChains(), init()]);
      if (!live) return;
      setChains(meta);
      // useWallet is a plain setter on the SDK, not a React hook.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      Trustware.useWallet(eip1193Wallet(provider));
      const results = new Map();
      try {
        for await (const batch of Trustware.getBalancesByAddressStream(address, {
          signal: controller.signal,
          onSummary: (summary) => live && setScan((s) => ({ ...s, completed: summary.completed ?? s.completed, total: summary.total ?? s.total })),
        })) {
          if (!live) return;
          for (const r of batch) results.set(String(r.chain_id), r);
          setScan({ results: new Map(results), done: false, completed: results.size, total: 0 });
        }
      } catch (reason) {
        if (live && reason?.name !== "AbortError") callbacks.current.onError?.(reason?.message || "Your balances could not be loaded.");
      }
      if (live) setScan((s) => ({ ...s, results: new Map(results), done: true }));
    })();
    return () => { live = false; controller.abort(); };
  }, [provider, address]);

  const [prices, setPrices] = useState({});
  const asked = useRef(new Set());
  const holdings = useMemo(() => holdingsFrom([...scan.results.values()], prices), [scan.results, prices]);
  // Price the non-stable holdings once each, as they show up.
  useEffect(() => {
    for (const row of holdings) {
      if (row.price != null || asked.current.has(row.key)) continue;
      asked.current.add(row.key);
      priceOf(row.chainId, tokenAddress(row), row.symbol)
        .then((price) => price != null && setPrices((p) => ({ ...p, [row.key]: price })))
        .catch(() => {});
    }
  }, [holdings]);

  if (picked) {
    return (
      <RouteStep
        token={picked}
        chain={chains[picked.chainId]}
        address={address}
        minimumUsdg={minimumUsdg}
        walletBalance={walletBalance}
        exchangeBalance={exchangeBalance}
        onDeposit={onDeposit}
        onDone={onDone}
        onBack={() => setPicked(null)}
        onSent={(amount) => callbacks.current.onSent?.(amount)}
        onArrived={() => callbacks.current.onArrived?.()}
      />
    );
  }
  return (
    <div className="pm-xc">
      <button type="button" className="pm-xc-back" onClick={onExit}><ChevronLeft size={14} /> Deposit options</button>
      <p className="pm-xc-title">Pick what to deposit</p>
      <div className="pm-xc-list" aria-busy={!scan.done}>
        {holdings.map((row) => (
          <button type="button" key={row.key} className="pm-xc-token" onClick={() => setPicked(row)}>
            <TokenLogo row={row} chain={chains[row.chainId]} />
            <span><strong>{row.symbol}</strong><small>{chains[row.chainId]?.name ?? `Chain ${row.chainId}`}</small></span>
            <span><strong>{row.usd == null ? "…" : `$${money(row.usd)}`}</strong><small>{formatAmount(row.amount)} {row.symbol}</small></span>
          </button>
        ))}
        {!scan.done && (
          <div className="pm-xc-scanning"><Loader2 size={14} className="pm-wallet-spin" /> Looking for funds on every chain…</div>
        )}
        {scan.done && !holdings.length && (
          <div className="pm-xc-empty">
            <strong>No funds found on other chains</strong>
            <small>This wallet has nothing over ${MIN_USD} outside Robinhood Chain.</small>
          </div>
        )}
      </div>
    </div>
  );
}

function RouteStep({ token, chain, address, minimumUsdg, walletBalance, exchangeBalance, onDeposit, onDone, onBack, onSent, onArrived }) {
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState({ key: null });
  const [stage, setStage] = useState("idle"); // idle | signing | sent
  // USDG already in the wallet when the route was sent: anything above it is this deposit landing.
  const [baseline, setBaseline] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  // direct: the route deposits into the Exchange itself; wallet: USDG land in the wallet and the deposit is one more step.
  const [mode, setMode] = useState("direct");
  const balanceNow = useRef({ walletBalance, exchangeBalance });
  useEffect(() => { balanceNow.current = { walletBalance, exchangeBalance }; }, [walletBalance, exchangeBalance]);
  const [error, setError] = useState("");
  const value = Number(amount);
  const tooMuch = value > token.amount;
  const base = useMemo(() => {
    if (!(value > 0) || tooMuch) return null;
    try { return parseUnits(String(amount), token.decimals).toString(); } catch { return null; }
  }, [amount, value, tooMuch, token.decimals]);

  // Live estimate while typing (no intent is created until the user confirms).
  useEffect(() => {
    if (!base) return;
    let live = true;
    const key = base;
    const timer = setTimeout(() => {
      fetch(`${API}/routes/quote`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-API-Key": TRUSTWARE_API_KEY },
        body: JSON.stringify({ fromChain: token.chainId, fromToken: tokenAddress(token), toChain: String(TRUSTED.chainId), toToken: TRUSTED.collateral, fromAmount: base, fromAddress: address, toAddress: address, slippage: SLIPPAGE }),
      })
        .then((r) => r.json().then((body) => (r.ok ? body : Promise.reject(new Error(body.error || body.message || "No route for this amount.")))))
        .then((body) => live && setQuote({ key, estimate: body.data?.estimate ?? body.estimate }))
        .catch((reason) => live && setQuote({ key, error: reason.message }));
    }, 450);
    return () => { live = false; clearTimeout(timer); };
  }, [base, token, address]);

  const fresh = quote.key === base ? quote : null;
  const receive = fresh?.estimate ? Number(formatUnits(BigInt(fresh.estimate.toAmount ?? "0"), 6)) : null;
  const receiveMin = fresh?.estimate ? Number(formatUnits(BigInt(fresh.estimate.toAmountMin ?? fresh.estimate.toAmount ?? "0"), 6)) : null;
  const usdIn = token.price != null && value > 0 ? value * token.price : null;
  const tooSmall = (usdIn != null && usdIn < MIN_CROSS_CHAIN_USD) || (receiveMin != null && receiveMin < minimumUsdg);

  async function send() {
    setError("");
    setStage("signing");
    try {
      const request = {
        fromChain: token.chainId, fromToken: tokenAddress(token), toChain: String(TRUSTED.chainId), toToken: TRUSTED.collateral,
        fromAmount: base, fromAddress: address, toAddress: address, slippage: SLIPPAGE,
      };
      // Direct deposit when a provider takes the destination call; otherwise the plain route to the wallet.
      let route;
      let used = "direct";
      try {
        route = await Trustware.buildRoute({ ...request, hooks: directDepositHook(address) });
      } catch {
        used = "wallet";
        route = await Trustware.buildRoute(request);
      }
      setMode(used);
      const tx = await Trustware.sendRouteTransaction(route, token.chainId);
      // Sent: nothing left for the user to do here. Tracking goes on in the background; the app also sees the USDG
      // land (balance polling), so closing this sheet loses nothing.
      setBaseline(balanceNow.current);
      setStage("sent");
      onSent?.(receive);
      void Trustware.submitReceipt(route.intentId, tx)
        .then(() => Trustware.pollStatus(route.intentId))
        .then((result) => { if (result?.status === "success") { setConfirmed(true); onArrived(); } else if (result?.status === "failed") setError("The transfer failed. Your funds were not taken, or will be refunded."); })
        .catch(() => {});
    } catch (reason) {
      setStage("idle");
      setError(reason?.code === 4001 ? "Signature cancelled in your wallet." : reason?.message || "The deposit failed.");
    }
  }

  const busy = stage === "signing";
  if (stage === "sent") {
    if (mode === "direct") {
      // Landed in the Exchange; or, if the destination call couldn't run, in the wallet (the fallback address).
      const inExchange = baseline != null && exchangeBalance > baseline.exchangeBalance + 0.05;
      const inWallet = baseline != null && walletBalance > baseline.walletBalance + 0.5;
      if (inWallet && !inExchange) return <ArrivalSteps chain={chain} expected={receive} arrived walletBalance={walletBalance} minimumUsdg={minimumUsdg} onDeposit={onDeposit} />;
      return <DirectSteps chain={chain} expected={receive} landed={inExchange} credited={inExchange ? exchangeBalance - baseline.exchangeBalance : null} onDone={onDone} />;
    }
    const arrived = confirmed || (baseline != null && walletBalance > baseline.walletBalance + 0.5);
    return <ArrivalSteps chain={chain} expected={receive} arrived={arrived} walletBalance={walletBalance} minimumUsdg={minimumUsdg} onDeposit={onDeposit} />;
  }
  // Native gas tokens keep a little for the source transaction itself.
  const max = token.category === "native" ? token.amount * 0.97 : token.amount;
  return (
    <div className="pm-xc">
      <button type="button" className="pm-xc-back" onClick={onBack} disabled={busy}><ChevronLeft size={14} /> All assets</button>
      <div className="pm-amount">
        <div className="pm-amount-box">
          <span className="pm-amount-chip"><TokenLogo row={token} chain={chain} small /> {token.symbol}</span>
          <input autoFocus type="number" inputMode="decimal" min="0" step="any" placeholder="0.00" aria-label={`Amount in ${token.symbol}`} value={amount} disabled={busy} onChange={(e) => { setAmount(e.target.value); setError(""); }} />
        </div>
        <div className="pm-amount-meta">
          <span>{formatAmount(token.amount)} {token.symbol} on {chain?.name ?? `chain ${token.chainId}`}</span>
          <button type="button" onClick={() => setAmount(String(Number(max.toPrecision(8))))} disabled={busy}>Max</button>
        </div>
      </div>
      <dl className="pm-xc-quote">
        <div><dt>You receive</dt><dd>{!base ? "—" : receive != null ? `≈ ${money(receive)} USDG` : fresh?.error ? "No route" : "…"}</dd></div>
        <div><dt>Network & route fees</dt><dd>{fresh?.estimate?.totalFeesUsd ? `$${money(Number(fresh.estimate.totalFeesUsd))}` : "—"}</dd></div>
        <div><dt>Arrives in</dt><dd>{fresh?.estimate?.etaSeconds != null ? (fresh.estimate.etaSeconds < 60 ? "under a minute" : `~${Math.ceil(fresh.estimate.etaSeconds / 60)} min`) : "—"}</dd></div>
      </dl>
      <button className="pm-sheet-primary" onClick={send} disabled={busy || !base || !(receive > 0) || tooSmall}>
        {stage === "signing" ? "Confirm in your wallet…" : tooMuch ? `Not enough ${token.symbol}` : !base ? "Enter an amount" : tooSmall ? `Minimum $${MIN_CROSS_CHAIN_USD} from another chain` : receive > 0 ? `Deposit ≈ ${money(receive)} USDG` : fresh?.error ? "No route for this amount" : "Getting the best route…"}
      </button>
      <p className="pm-sheet-note">{error || (busy ? "Keep this window open. Your wallet may ask for an approval first." : `Minimum $${MIN_CROSS_CHAIN_USD}, so at least ${money(minimumUsdg, 0)} USDG arrive after fees. Lands in your wallet on Robinhood Chain.`)}</p>
    </div>
  );
}

/** Direct deposit: sent → credited to the trading account. No other signature. */
function DirectSteps({ chain, expected, landed, credited, onDone }) {
  const step = (done, active, title, detail) => (
    <li className={done ? "is-done" : active ? "is-active" : ""}>
      <span>{done ? <Check size={13} /> : active ? <Loader2 size={13} className="pm-wallet-spin" /> : null}</span>
      <div><strong>{title}</strong>{detail && <small>{detail}</small>}</div>
    </li>
  );
  return (
    <div className="pm-xc pm-xc-steps">
      <p className="pm-xc-title">{landed ? "Ready to trade" : "On its way"}</p>
      <ol>
        {step(true, false, `Sent from ${chain?.name ?? "your chain"}`)}
        {step(landed, !landed, landed ? `${money(credited)} USDG in your trading account` : `≈ ${money(expected ?? 0)} USDG going into your trading account`, landed ? null : "Usually under a minute")}
      </ol>
      {landed && <button className="pm-sheet-primary" onClick={onDone}>Start trading</button>}
      <p className="pm-sheet-note">{landed ? "A first deposit includes the one-time 1 USDG activation fee." : "No other signature needed. You can close this: it lands on its own."}</p>
    </div>
  );
}

/** After the route is sent: sent → arriving → deposit, in one place. The deposit is one gas-free signature. */
function ArrivalSteps({ chain, expected, arrived, walletBalance, minimumUsdg, onDeposit }) {
  const [state, setState] = useState("idle"); // idle | signing | done
  const [error, setError] = useState("");
  const amount = Math.floor(walletBalance * 100) / 100;
  const enough = amount >= minimumUsdg;
  async function deposit() {
    setError("");
    setState("signing");
    const result = await onDeposit(amount);
    if (result?.ok) setState("done");
    else { setState("idle"); setError(result?.error || "The deposit failed."); }
  }
  const step = (done, active, title, detail) => (
    <li className={done ? "is-done" : active ? "is-active" : ""}>
      <span>{done ? <Check size={13} /> : active ? <Loader2 size={13} className="pm-wallet-spin" /> : null}</span>
      <div><strong>{title}</strong>{detail && <small>{detail}</small>}</div>
    </li>
  );
  return (
    <div className="pm-xc pm-xc-steps">
      <p className="pm-xc-title">{state === "done" ? "Ready to trade" : arrived ? "Your USDG arrived" : "On its way"}</p>
      <ol>
        {step(true, false, `Sent from ${chain?.name ?? "your chain"}`)}
        {step(arrived, !arrived, arrived ? `${money(walletBalance)} USDG on Robinhood Chain` : `≈ ${money(expected ?? 0)} USDG arriving on Robinhood Chain`, arrived ? null : "Usually under a minute")}
        {step(state === "done", arrived && state !== "done", "Deposit to trade", arrived ? "One signature, no gas" : null)}
      </ol>
      {arrived && state !== "done" && (
        <button className="pm-sheet-primary" onClick={deposit} disabled={state === "signing" || !enough}>
          {state === "signing" ? "Confirm in your wallet…" : enough ? `Deposit ${money(amount)} USDG` : `Minimum deposit is ${money(minimumUsdg, 0)} USDG`}
        </button>
      )}
      <p className="pm-sheet-note">{error || (arrived ? (minimumUsdg > 10 ? `First deposit includes a one-time ${money(minimumUsdg - 10, 0)} USDG activation fee.` : "Lands on the Exchange right away.") : "You can keep this open or close it: the deposit will be waiting.")}</p>
    </div>
  );
}

function TokenLogo({ row, chain, small = false }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`pm-xc-logo${small ? " is-small" : ""}`}>
      {row.logoURI && !broken ? <img src={row.logoURI} alt="" onError={() => setBroken(true)} /> : <span>{(row.symbol || "?").slice(0, 1)}</span>}
      {!small && chain?.icon && <img className="pm-xc-chain" src={chain.icon} alt="" />}
    </span>
  );
}

const formatAmount = (n) => (n >= 1000 ? money(n, 0) : n >= 1 ? money(n, 4) : Number(n.toPrecision(4)).toString());
