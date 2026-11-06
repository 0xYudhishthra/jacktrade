import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { erc20Abi, formatUnits } from "viem";
import { useWallet } from "../components/Wallet.jsx";
import { ErrorBox, TxHash, fmtPrice, fmtUsd, timeAgo } from "../components/Common.jsx";
import { flashOrder, flashOrderDetail, flashOrders, flashQuote, getBet } from "../lib/api.js";
import { publicClient, short } from "../lib/chain.js";
import { FLASH_CHAIN, NATIVE_SENTINEL, TOKENS } from "../lib/config.js";
import { errMsg, sendAndWait, signTypedDataJson } from "../lib/wallet.js";
import { isLong, marketSymbol } from "./Bets.jsx";

const TARGETS = { TSLA: TOKENS.TSLA, NVDA: TOKENS.NVDA, ETH: TOKENS.WETH };

function targetFor(symbol) {
  if (symbol === "TSLA" || symbol === "NVDA") return { key: symbol, note: "" };
  if (symbol === "ETH" || symbol === "WETH")
    return { key: "ETH", note: "ETH bet → buying WETH, the wrapped ETH token on Robinhood Chain." };
  if (symbol === "BTC")
    return {
      key: "TSLA",
      note: "There's no wrapped BTC on Robinhood Chain in this app yet, so this defaults to the TSLA stock token. Pick another target below.",
    };
  return {
    key: "TSLA",
    note: symbol ? `No ${symbol} token mapped on Robinhood Chain; defaulting to TSLA.` : "",
  };
}

const STATUS_LABEL = {
  ORDER_STATUS_UNSPECIFIED: "Unknown",
  ORDER_STATUS_PENDING: "Pending",
  ORDER_STATUS_ACCEPTED: "Accepted (working)",
  ORDER_STATUS_PARTIALLY_FILLED: "Partially filled",
  ORDER_STATUS_FILLED: "Filled",
  ORDER_STATUS_CANCELLED: "Cancelled",
  ORDER_STATUS_REJECTED: "Rejected",
  ORDER_STATUS_TERMINATED: "Terminated",
};
const statusLabel = (s) => STATUS_LABEL[s] || String(s || "").replace(/^ORDER_STATUS_/, "") || "–";
const statusTone = (s) =>
  /FILLED$/.test(s) && !/PARTIALLY/.test(s)
    ? "pos"
    : /CANCELLED|REJECTED|TERMINATED/.test(s)
      ? "neg"
      : "";

const priceStr = (n) => (Number.isFinite(n) ? n.toFixed(n >= 100 ? 2 : 4) : "");
const trimNum = (n, dp) => {
  const s = Number(n).toFixed(dp);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};
const nonEmpty = (v) => typeof v === "string" && v.length > 0;

export default function RealPage() {
  const { id } = useParams();
  const { account, wrongChain, connect, switchChain } = useWallet();

  const [bet, setBet] = useState(null);
  const [betErr, setBetErr] = useState("");

  const [targetKey, setTargetKey] = useState("TSLA");
  const [direction, setDirection] = useState("long"); // long → market+bracket, short → limit buy
  const [payWith, setPayWith] = useState("USDG");
  const [usdAmount, setUsdAmount] = useState("10");
  const [ethAmount, setEthAmount] = useState("0.005");
  const [maxSlippagePct, setMaxSlippagePct] = useState("");

  const [refPrice, setRefPrice] = useState(null);
  const [priceErr, setPriceErr] = useState("");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [limitPx, setLimitPx] = useState("");

  const [balances, setBalances] = useState(null);

  const [quote, setQuote] = useState(null);
  const [quoteBody, setQuoteBody] = useState(null);
  const [quoteAt, setQuoteAt] = useState(0);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteErr, setQuoteErr] = useState("");

  const [log, setLog] = useState([]); // [{label, hash?, state}]
  const [execBusy, setExecBusy] = useState(false);
  const [execErr, setExecErr] = useState("");
  const [orderId, setOrderId] = useState(null);
  const [orders, setOrders] = useState([]);
  const [detail, setDetail] = useState(null);
  const pollRef = useRef(null);

  const target = TARGETS[targetKey];
  const mapping = useMemo(() => targetFor(marketSymbol(bet?.market)), [bet]);
  const leverage = Math.max(1, Number(bet?.leverage) || 50);
  const liqPct = Math.min(0.2, Math.max(0.005, 1 / leverage));

  // Load the bet.
  useEffect(() => {
    let alive = true;
    setBet(null);
    setBetErr("");
    getBet(id)
      .then((b) => {
        if (!alive) return;
        setBet(b);
        const m = targetFor(marketSymbol(b?.market));
        setTargetKey(m.key);
        setDirection(isLong(b?.side) ? "long" : "short");
      })
      .catch((err) => alive && setBetErr(err.message || "Bet not found"));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (targetKey === "ETH" && payWith === "ETH") setPayWith("USDG");
  }, [targetKey, payWith]);

  // Reference price of the real token from a small Flash quote (no wallet needed).
  const loadPrice = useCallback(async () => {
    setPriceErr("");
    setRefPrice(null);
    try {
      const q = await flashQuote({
        targetChain: FLASH_CHAIN,
        contraChain: FLASH_CHAIN,
        targetAsset: target.address,
        contraAsset: TOKENS.USDG.address,
        side: "buy",
        qty: "10",
        orderType: "market",
      });
      const p = Number(q?.to?.notional) / Number(q?.to?.amount);
      if (!Number.isFinite(p) || p <= 0) throw new Error("Couldn't derive a price from the Flash quote");
      setRefPrice(p);
    } catch (err) {
      setPriceErr(`Price unavailable: ${err.message}`);
    }
  }, [target.address]);

  useEffect(() => {
    loadPrice();
  }, [loadPrice]);

  // Derive bracket / limit from the bet's leverage and the live token price.
  useEffect(() => {
    if (!refPrice) return;
    setTp(priceStr(refPrice * (1 + 2 * liqPct)));
    setSl(priceStr(refPrice * (1 - liqPct)));
    setLimitPx(priceStr(refPrice * (1 - liqPct)));
  }, [refPrice, liqPct]);

  // Clear any stale quote when inputs change.
  useEffect(() => {
    setQuote(null);
    setQuoteBody(null);
    setQuoteErr("");
  }, [targetKey, direction, payWith, usdAmount, ethAmount, maxSlippagePct, tp, sl, limitPx, account]);

  // Wallet balances on Robinhood Chain.
  const loadBalances = useCallback(async () => {
    if (!account) return setBalances(null);
    try {
      const [usdg, eth] = await Promise.all([
        publicClient.readContract({
          address: TOKENS.USDG.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
        }),
        publicClient.getBalance({ address: account }),
      ]);
      setBalances({ usdg: Number(formatUnits(usdg, 6)), eth: Number(formatUnits(eth, 18)) });
    } catch {
      setBalances(null);
    }
  }, [account]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  function buildBody(spendAsset) {
    const qty = payWith === "ETH" ? String(ethAmount).trim() : trimNum(usdAmount, 6);
    if (!(Number(qty) > 0)) throw new Error("Enter an amount greater than zero");
    const body = {
      targetChain: FLASH_CHAIN,
      contraChain: FLASH_CHAIN,
      targetAsset: target.address,
      contraAsset: spendAsset,
      side: "buy",
      qty,
      orderType: direction === "long" ? "market" : "limit",
      funderAddress: account,
    };
    if (direction === "long") {
      const tpN = Number(tp);
      const slN = Number(sl);
      if (!(tpN > 0) || !(slN > 0)) throw new Error("Set both take-profit and stop-loss prices");
      if (!(tpN > slN)) throw new Error("Take-profit must be above stop-loss");
      if (refPrice && (slN >= refPrice || tpN <= refPrice))
        throw new Error("Stop-loss must be below and take-profit above the current price");
      body.attachedBracket = { takeProfit: { notionalPrice: String(tp) }, stopLoss: { notionalPrice: String(sl) } };
      if (Number(maxSlippagePct) > 0) body.maxSlippage = trimNum(Number(maxSlippagePct) / 100, 4);
    } else {
      const lp = Number(limitPx);
      if (!(lp > 0)) throw new Error("Set a limit price");
      body.limitNotionalPrice = String(limitPx);
    }
    return body;
  }

  async function getQuote() {
    setQuoteErr("");
    setExecErr("");
    setQuoteBusy(true);
    try {
      const spend = payWith === "ETH" ? NATIVE_SENTINEL : TOKENS.USDG.address;
      const body = buildBody(spend);
      const q = await flashQuote(body);
      if (!q?.quoteId || !q?.evm) throw new Error("Unexpected quote response");
      if (!nonEmpty(q.evm.orderTypedData)) throw new Error("Quote has no order payload to sign");
      setQuote(q);
      setQuoteBody(body);
      setQuoteAt(Date.now());
    } catch (err) {
      setQuoteErr(errMsg(err));
    } finally {
      setQuoteBusy(false);
    }
  }

  const logSeq = useRef(0);
  const addLog = (label) => {
    const key = ++logSeq.current;
    setLog((l) => [...l, { key, label, state: "active" }]);
    const patch = (p) => setLog((l) => l.map((x) => (x.key === key ? { ...x, ...p } : x)));
    return {
      hash: (hash) => patch({ hash }),
      done: () => patch({ state: "done" }),
      fail: () => patch({ state: "error" }),
    };
  };

  async function runStep(label, fn) {
    const s = addLog(label);
    try {
      const r = await fn(s);
      s.done();
      return r;
    } catch (err) {
      s.fail();
      throw err;
    }
  }

  async function execute() {
    setExecErr("");
    setLog([]);
    setOrderId(null);
    setDetail(null);
    setExecBusy(true);
    try {
      let q = quote;
      let body = quoteBody;

      // 1) Onchain prerequisites from the quote (wrap, approvals). Re-quote afterwards so the
      //    signed payloads are fresh and reflect the new allowances.
      let sentTx = false;
      if (q.wrap?.evmTx) {
        const wrapped = q.wrap.wrappedAsset;
        await runStep(`Wrap ${body.qty} ETH → WETH`, (s) => sendAndWait(account, q.wrap.evmTx, s.hash));
        body = { ...body, contraAsset: wrapped };
        sentTx = true;
      }
      if (q.evm.approveTx) {
        const sym = payWith === "ETH" ? "WETH" : "USDG";
        await runStep(`Approve ${sym} for Flash (one-time)`, (s) => sendAndWait(account, q.evm.approveTx, s.hash));
        sentTx = true;
      }
      if (q.attachedBracket?.evm?.approveTx) {
        await runStep(`Approve ${target.symbol} for the take-profit / stop-loss exits (one-time)`, (s) =>
          sendAndWait(account, q.attachedBracket.evm.approveTx, s.hash),
        );
        sentTx = true;
      }
      const stale = Date.now() - quoteAt > 120_000;
      if (sentTx || stale) {
        q = await runStep("Refresh quote", async () => {
          if (sentTx) await new Promise((r) => setTimeout(r, 2500)); // let Flash see the new allowance
          const fresh = await flashQuote(body);
          if (!fresh?.quoteId || !nonEmpty(fresh?.evm?.orderTypedData)) throw new Error("Unexpected quote response");
          return fresh;
        });
        if (q.wrap?.evmTx) throw new Error("Flash still asks for a wrap; check your WETH balance and try again.");
        if (q.evm.approveTx) {
          await runStep("Approve spend token (again)", (s) => sendAndWait(account, q.evm.approveTx, s.hash));
          q = await flashQuote(body);
        }
        if (q.attachedBracket?.evm?.approveTx) {
          await runStep(`Approve ${target.symbol} for exits (again)`, (s) =>
            sendAndWait(account, q.attachedBracket.evm.approveTx, s.hash),
          );
          q = await flashQuote(body);
        }
        setQuote(q);
        setQuoteBody(body);
        setQuoteAt(Date.now());
      }

      // 2) Signatures (gasless).
      let permitFields = {};
      if (nonEmpty(q.evm.permitTypedData)) {
        const sig = await runStep("Sign Permit2 approval", () => signTypedDataJson(account, q.evm.permitTypedData));
        permitFields = { evmPermitTypedData: q.evm.permitTypedData, evmPermitSignature: sig };
      }
      const userSignature = await runStep(
        direction === "long" ? "Sign the market buy" : "Sign the limit buy",
        () => signTypedDataJson(account, q.evm.orderTypedData),
      );

      if (body.attachedBracket && !nonEmpty(q.attachedBracket?.evm?.orderTypedData)) {
        throw new Error("Flash didn't return a bracket payload; not placing an unprotected order.");
      }
      let attachedBracket;
      if (body.attachedBracket && q.attachedBracket?.evm) {
        let bracketPermit = {};
        if (nonEmpty(q.attachedBracket.evm.permitTypedData)) {
          const sig = await runStep("Sign Permit2 for the exits", () =>
            signTypedDataJson(account, q.attachedBracket.evm.permitTypedData),
          );
          bracketPermit = { evmPermitTypedData: q.attachedBracket.evm.permitTypedData, evmPermitSignature: sig };
        }
        const bracketSig = await runStep("Sign the take-profit / stop-loss pair", () =>
          signTypedDataJson(account, q.attachedBracket.evm.orderTypedData),
        );
        attachedBracket = {
          ...body.attachedBracket,
          userSignature: bracketSig,
          salt: q.attachedBracket.salt,
          deadline: q.attachedBracket.deadline,
          signedMaxFromAmount: q.attachedBracket.signedMaxFromAmount,
          ...bracketPermit,
        };
      }

      // 3) Submit.
      const orderBody = {
        ...body,
        targetAsset: q.targetAsset || body.targetAsset,
        contraAsset: q.contraAsset || body.contraAsset,
        quoteId: q.quoteId,
        userSignature,
        evmOrderTypedData: q.evm.orderTypedData,
        ...permitFields,
      };
      if (attachedBracket) orderBody.attachedBracket = attachedBracket;
      else delete orderBody.attachedBracket;

      const res = await runStep("Submit order to Definitive Flash", () => flashOrder(orderBody));
      if (!res?.orderId) throw new Error("Flash did not return an order id");
      setOrderId(res.orderId);
      loadBalances();
    } catch (err) {
      setExecErr(errMsg(err));
    } finally {
      setExecBusy(false);
    }
  }

  // Poll Flash orders for this wallet.
  useEffect(() => {
    if (!account) return;
    let alive = true;
    const tick = async () => {
      try {
        const list = await flashOrders(account);
        if (alive) setOrders(list);
        if (orderId) {
          const d = await flashOrderDetail(orderId, account);
          if (alive && d) setDetail(d);
        }
      } catch {
        /* connector may be down; keep polling */
      }
      if (alive) pollRef.current = setTimeout(tick, orderId ? 4000 : 15000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(pollRef.current);
    };
  }, [account, orderId]);

  const myOrder = orderId ? orders.find((o) => o.orderId === orderId) || detail?.order : null;
  const fills = detail?.fills || [];
  const bracketOrder = myOrder?.attachedBracket?.bracketOrderId
    ? orders.find((o) => o.orderId === myOrder.attachedBracket.bracketOrderId)
    : null;

  const spendLabel = payWith === "ETH" ? "ETH" : "USDG";
  const lowUsdg = payWith === "USDG" && balances && balances.usdg < Number(usdAmount);
  const betSymbol = marketSymbol(bet?.market);

  return (
    <div className="page">
      <section className="hero hero-sm">
        <p className="eyebrow">
          <Link to="/bets">← Grok bets</Link>
        </p>
        <h1>Make it real</h1>
        <p className="lead">
          Copy a Grok bet into the real token on Robinhood Chain with a Definitive Flash order. Your wallet, your
          tokens, MEV-protected execution.
        </p>
      </section>

      <section className="card">
        <h3>The Grok bet</h3>
        {bet ? (
          <div className="bet-grid">
            <div>
              <span className="stat-label">Market</span>
              <span>{betSymbol || bet.market}</span>
            </div>
            <div>
              <span className="stat-label">Side</span>
              <span className={isLong(bet.side) ? "pos" : "neg"}>{isLong(bet.side) ? "LONG" : "SHORT"}</span>
            </div>
            <div>
              <span className="stat-label">Leverage</span>
              <span>{bet.leverage}×</span>
            </div>
            <div>
              <span className="stat-label">Entry</span>
              <span>{bet.entryPrice ? fmtPrice(bet.entryPrice) : "–"}</span>
            </div>
            <div>
              <span className="stat-label">Margin</span>
              <span>{fmtUsd(bet.marginUsd)}</span>
            </div>
            <div>
              <span className="stat-label">Placed</span>
              <span>{timeAgo(bet.openedAt) || "–"}</span>
            </div>
          </div>
        ) : betErr ? (
          <div className="alert alert-warn">
            Couldn't load bet <span className="mono">{id}</span> ({betErr}). You can still set up an order below.
          </div>
        ) : (
          <p className="muted">Loading bet…</p>
        )}
        {mapping.note && bet && <p className="note">{mapping.note}</p>}
      </section>

      <section className="card">
        <h3>Your order</h3>
        <div className="form-grid">
          <label>
            <span>Buy (real token)</span>
            <select value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>
              <option value="TSLA">TSLA (Tesla stock token)</option>
              <option value="NVDA">NVDA (Nvidia stock token)</option>
              <option value="ETH">WETH (wrapped ETH)</option>
            </select>
          </label>
          <label>
            <span>Strategy</span>
            <select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="long">Long → market buy + take-profit / stop-loss</option>
              <option value="short">Short → limit buy below the market</option>
            </select>
          </label>
          <label>
            <span>Pay with</span>
            <select value={payWith} onChange={(e) => setPayWith(e.target.value)}>
              <option value="USDG">USDG</option>
              <option value="ETH" disabled={targetKey === "ETH"}>
                ETH (native){targetKey === "ETH" ? " (n/a for WETH)" : ""}
              </option>
            </select>
          </label>
          {payWith === "USDG" ? (
            <label>
              <span>Amount (USDG)</span>
              <input
                type="number"
                min="1"
                step="1"
                value={usdAmount}
                onChange={(e) => setUsdAmount(e.target.value)}
              />
            </label>
          ) : (
            <label>
              <span>Amount (ETH)</span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={ethAmount}
                onChange={(e) => setEthAmount(e.target.value)}
              />
            </label>
          )}
        </div>

        <div className="price-line">
          <span className="muted">{target.symbol} now</span>
          <b>{refPrice ? `$${fmtPrice(refPrice)}` : priceErr ? "–" : "…"}</b>
          <button className="btn btn-ghost btn-sm" onClick={loadPrice}>
            Refresh
          </button>
          <span className="muted small">
            Derived from the bet's {leverage}× leverage: liquidation distance ≈ {(liqPct * 100).toFixed(2)}%
          </span>
        </div>
        <ErrorBox error={priceErr} />

        {direction === "long" ? (
          <div className="form-grid">
            <label>
              <span>Take-profit (USD, +2× liq. distance)</span>
              <input type="number" step="0.01" value={tp} onChange={(e) => setTp(e.target.value)} />
            </label>
            <label>
              <span>Stop-loss (USD, at liq. distance)</span>
              <input type="number" step="0.01" value={sl} onChange={(e) => setSl(e.target.value)} />
            </label>
            <label>
              <span>Max slippage % (blank = Flash recommended)</span>
              <input
                type="number"
                step="0.1"
                min="0"
                placeholder="auto"
                value={maxSlippagePct}
                onChange={(e) => setMaxSlippagePct(e.target.value)}
              />
            </label>
          </div>
        ) : (
          <div className="form-grid">
            <label>
              <span>Limit buy price (USD, liq. distance below)</span>
              <input type="number" step="0.01" value={limitPx} onChange={(e) => setLimitPx(e.target.value)} />
            </label>
            <p className="muted small span-2">
              The short bets on a drop. This rests a limit buy at that level (good-til-cancelled) so you pick up
              the real token if Grok is right.
            </p>
          </div>
        )}

        {!account ? (
          <button className="btn" onClick={() => connect().catch(() => {})}>
            Connect wallet
          </button>
        ) : wrongChain ? (
          <button className="btn btn-warn" onClick={switchChain}>
            Switch to Robinhood Chain
          </button>
        ) : (
          <div className="actions">
            <button className="btn" onClick={getQuote} disabled={quoteBusy || execBusy}>
              {quoteBusy ? "Quoting…" : quote ? "Re-quote" : "Get Flash quote"}
            </button>
            {balances && (
              <span className="muted small">
                Wallet: {balances.usdg.toFixed(2)} USDG · {balances.eth.toFixed(5)} ETH
              </span>
            )}
          </div>
        )}
        {lowUsdg && <div className="alert alert-warn small">Your wallet has less USDG than this order spends.</div>}
        <ErrorBox error={quoteErr} />

        {quote && (
          <div className="quote">
            <div className="kv">
              <span>You spend</span>
              <span>
                {quote.from?.amount} {spendLabel} ({fmtUsd(quote.from?.notional)})
              </span>
              <span>You get (est.)</span>
              <span>
                {Number(quote.to?.amount).toPrecision(6)} {target.symbol} ({fmtUsd(quote.to?.notional)})
              </span>
              <span>Fees (est.)</span>
              <span>{fmtUsd(quote.fees?.estimatedFeeNotional, 4)}</span>
              {quote.estimatedPriceImpact != null && (
                <>
                  <span>Price impact</span>
                  <span>{(Number(quote.estimatedPriceImpact) * 100).toFixed(3)}%</span>
                </>
              )}
              {quote.recommendedSlippage != null && (
                <>
                  <span>Slippage</span>
                  <span>
                    {quoteBody?.maxSlippage
                      ? `${(Number(quoteBody.maxSlippage) * 100).toFixed(2)}% (yours)`
                      : `${(Number(quote.recommendedSlippage) * 100).toFixed(2)}% (Flash recommended)`}
                  </span>
                </>
              )}
              {quoteBody?.attachedBracket && (
                <>
                  <span>Bracket</span>
                  <span>
                    TP ${quoteBody.attachedBracket.takeProfit.notionalPrice} / SL $
                    {quoteBody.attachedBracket.stopLoss.notionalPrice}
                  </span>
                </>
              )}
              {quoteBody?.limitNotionalPrice && (
                <>
                  <span>Limit</span>
                  <span>${quoteBody.limitNotionalPrice} (good-til-cancelled)</span>
                </>
              )}
            </div>
            <p className="muted small">
              Wallet prompts:{" "}
              {[
                quote.wrap?.evmTx && "wrap ETH (tx)",
                quote.evm.approveTx && `approve ${spendLabel === "ETH" ? "WETH" : "USDG"} (tx)`,
                quote.attachedBracket?.evm?.approveTx && `approve ${target.symbol} for exits (tx)`,
                nonEmpty(quote.evm.permitTypedData) && "Permit2 (signature)",
                "order (signature)",
                quote.attachedBracket?.evm && "take-profit / stop-loss (signature)",
              ]
                .filter(Boolean)
                .join(" → ")}
            </p>
            <button className="btn btn-accent" onClick={execute} disabled={execBusy}>
              {execBusy ? "Follow your wallet…" : "Place order"}
            </button>
          </div>
        )}

        {log.length > 0 && (
          <ol className="exec-log">
            {log.map((s) => (
              <li key={s.key} className={`exec-${s.state}`}>
                <span className="exec-dot">{s.state === "done" ? "✓" : s.state === "error" ? "✕" : "…"}</span>
                <span>{s.label}</span>
                {s.hash && (
                  <span className="small">
                    <TxHash hash={s.hash} />
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        <ErrorBox error={execErr} />
      </section>

      {orderId && (
        <section className="card">
          <h3>Order status</h3>
          <div className="kv">
            <span>Order id</span>
            <span className="mono selectable">{orderId}</span>
            <span>Status</span>
            <span className={statusTone(myOrder?.status)}>{myOrder ? statusLabel(myOrder.status) : "Submitted…"}</span>
            {myOrder?.filled && Number(myOrder.filled.targetAmount) > 0 && (
              <>
                <span>Filled</span>
                <span>
                  {Number(myOrder.filled.targetAmount).toPrecision(6)} {target.symbol} @ $
                  {fmtPrice(myOrder.filled.averageNotionalPrice)}
                </span>
              </>
            )}
            {myOrder?.closeReason && (
              <>
                <span>Reason</span>
                <span>{myOrder.closeReason}</span>
              </>
            )}
            {myOrder?.attachedBracket && (
              <>
                <span>Bracket</span>
                <span>
                  {myOrder.attachedBracket.status}
                  {bracketOrder ? ` · ${statusLabel(bracketOrder.status)}` : ""}
                </span>
              </>
            )}
          </div>
          {fills.length > 0 && (
            <div className="fills">
              {fills.map((f, i) => (
                <p key={i} className="small">
                  Fill {fmtUsd(f.notional)} @ {fmtPrice(f.fillPrice)} · <TxHash hash={f.transactionId} />
                </p>
              ))}
            </div>
          )}
        </section>
      )}

      {account && orders.length > 0 && (
        <section className="card">
          <h3>Your recent Flash orders</h3>
          <div className="table">
            {orders.slice(0, 8).map((o) => (
              <div className="tr" key={o.orderId}>
                <span className="mono small">{short(o.orderId, 4)}</span>
                <span>
                  {o.orderType} {o.side}
                </span>
                <span>{o.targetAsset?.ticker || short(o.targetAsset?.address || "")}</span>
                <span className={statusTone(o.status)}>{statusLabel(o.status)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
