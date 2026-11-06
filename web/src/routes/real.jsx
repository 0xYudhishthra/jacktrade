// Make it real: copy an agent's bet into the real token on Robinhood Chain with a Definitive Flash order.
// Long → market buy with an attached take-profit / stop-loss. Short → limit buy below the market.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { erc20Abi, formatUnits } from "viem";
import { Shell, Panel } from "@/components/product/ProductUI";
import { ErrorBox, Note, TxHash, fmtPrice, fmtUsd, short, timeAgo } from "@/components/grok/GrokUI";
import { flashOrder, flashOrderDetail, flashOrders, flashQuote, getBet } from "@/lib/grok/api";
import { FLASH_CHAIN, NATIVE_SENTINEL, TOKENS } from "@/lib/grok/config";
import { errMsg, publicClient, sendAndWait, signTypedDataJson, useGrokWallet } from "@/lib/grok/wallet";
import { isLong, marketSymbol } from "@/lib/grok/bets";

const TARGETS = { TSLA: TOKENS.TSLA, NVDA: TOKENS.NVDA, ETH: TOKENS.WETH };

function targetFor(symbol) {
  if (symbol === "TSLA" || symbol === "NVDA") return { key: symbol, note: "" };
  if (symbol === "ETH" || symbol === "WETH")
    return { key: "ETH", note: "ETH bet → buying WETH, the wrapped ETH token on Robinhood Chain." };
  if (symbol === "BTC")
    return {
      key: "TSLA",
      note: "There's no wrapped BTC on Robinhood Chain here yet, so this defaults to the TSLA stock token. Pick another target below.",
    };
  return { key: "TSLA", note: symbol ? `No ${symbol} token on Robinhood Chain; defaulting to TSLA.` : "" };
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
  /FILLED$/.test(s) && !/PARTIALLY/.test(s) ? "pm-up" : /CANCELLED|REJECTED|TERMINATED/.test(s) ? "pm-down" : "";

const priceStr = (n) => (Number.isFinite(n) ? n.toFixed(n >= 100 ? 2 : 4) : "");
const trimNum = (n, dp) => {
  const s = Number(n).toFixed(dp);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};
const nonEmpty = (v) => typeof v === "string" && v.length > 0;

export default function RealPage() {
  const { id } = useParams({ strict: false });
  const wallet = useGrokWallet();
  const account = wallet.address;

  const [bet, setBet] = useState(null);
  const [betErr, setBetErr] = useState("");

  const [targetKey, setTargetKey] = useState("TSLA");
  const [direction, setDirection] = useState("long");
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

  const [log, setLog] = useState([]);
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

  useEffect(() => {
    let alive = true;
    setBet(null);
    setBetErr("");
    getBet(id)
      .then((b) => {
        if (!alive) return;
        setBet(b);
        setTargetKey(targetFor(marketSymbol(b?.market)).key);
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

  // Bracket / limit derived from the bet's leverage and the live token price.
  useEffect(() => {
    if (!refPrice) return;
    setTp(priceStr(refPrice * (1 + 2 * liqPct)));
    setSl(priceStr(refPrice * (1 - liqPct)));
    setLimitPx(priceStr(refPrice * (1 - liqPct)));
  }, [refPrice, liqPct]);

  // A changed input makes the quote stale.
  useEffect(() => {
    setQuote(null);
    setQuoteBody(null);
    setQuoteErr("");
  }, [targetKey, direction, payWith, usdAmount, ethAmount, maxSlippagePct, tp, sl, limitPx, account]);

  const loadBalances = useCallback(async () => {
    if (!account) return setBalances(null);
    try {
      const [usdg, eth] = await Promise.all([
        publicClient.readContract({ address: TOKENS.USDG.address, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
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
      if (!(Number(limitPx) > 0)) throw new Error("Set a limit price");
      body.limitNotionalPrice = String(limitPx);
    }
    return body;
  }

  async function getQuote() {
    setQuoteErr("");
    setExecErr("");
    setQuoteBusy(true);
    try {
      const body = buildBody(payWith === "ETH" ? NATIVE_SENTINEL : TOKENS.USDG.address);
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
    return { hash: (hash) => patch({ hash }), done: () => patch({ state: "done" }), fail: () => patch({ state: "error" }) };
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

      // 1) Onchain prerequisites (wrap, approvals), then re-quote so the signed payloads are fresh.
      let sentTx = false;
      if (q.wrap?.evmTx) {
        await runStep(`Wrap ${body.qty} ETH → WETH`, (s) => sendAndWait(wallet, q.wrap.evmTx, s.hash));
        body = { ...body, contraAsset: q.wrap.wrappedAsset };
        sentTx = true;
      }
      if (q.evm.approveTx) {
        const sym = payWith === "ETH" ? "WETH" : "USDG";
        await runStep(`Approve ${sym} for Flash (one-time)`, (s) => sendAndWait(wallet, q.evm.approveTx, s.hash));
        sentTx = true;
      }
      if (q.attachedBracket?.evm?.approveTx) {
        await runStep(`Approve ${target.symbol} for the take-profit / stop-loss exits (one-time)`, (s) =>
          sendAndWait(wallet, q.attachedBracket.evm.approveTx, s.hash),
        );
        sentTx = true;
      }
      if (sentTx || Date.now() - quoteAt > 120_000) {
        q = await runStep("Refresh quote", async () => {
          if (sentTx) await new Promise((r) => setTimeout(r, 2500)); // let Flash see the new allowance
          const fresh = await flashQuote(body);
          if (!fresh?.quoteId || !nonEmpty(fresh?.evm?.orderTypedData)) throw new Error("Unexpected quote response");
          return fresh;
        });
        if (q.wrap?.evmTx) throw new Error("Flash still asks for a wrap; check your WETH balance and try again.");
        if (q.evm.approveTx) {
          await runStep("Approve spend token (again)", (s) => sendAndWait(wallet, q.evm.approveTx, s.hash));
          q = await flashQuote(body);
        }
        if (q.attachedBracket?.evm?.approveTx) {
          await runStep(`Approve ${target.symbol} for exits (again)`, (s) =>
            sendAndWait(wallet, q.attachedBracket.evm.approveTx, s.hash),
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
        const sig = await runStep("Sign Permit2 approval", () => signTypedDataJson(wallet, q.evm.permitTypedData));
        permitFields = { evmPermitTypedData: q.evm.permitTypedData, evmPermitSignature: sig };
      }
      const userSignature = await runStep(direction === "long" ? "Sign the market buy" : "Sign the limit buy", () =>
        signTypedDataJson(wallet, q.evm.orderTypedData),
      );

      if (body.attachedBracket && !nonEmpty(q.attachedBracket?.evm?.orderTypedData)) {
        throw new Error("Flash didn't return a bracket payload; not placing an unprotected order.");
      }
      let attachedBracket;
      if (body.attachedBracket && q.attachedBracket?.evm) {
        let bracketPermit = {};
        if (nonEmpty(q.attachedBracket.evm.permitTypedData)) {
          const sig = await runStep("Sign Permit2 for the exits", () =>
            signTypedDataJson(wallet, q.attachedBracket.evm.permitTypedData),
          );
          bracketPermit = { evmPermitTypedData: q.attachedBracket.evm.permitTypedData, evmPermitSignature: sig };
        }
        const bracketSig = await runStep("Sign the take-profit / stop-loss pair", () =>
          signTypedDataJson(wallet, q.attachedBracket.evm.orderTypedData),
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

  // Poll this wallet's Flash orders.
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
  const prompts = quote
    ? [
        quote.wrap?.evmTx && "wrap ETH (tx)",
        quote.evm.approveTx && `approve ${spendLabel === "ETH" ? "WETH" : "USDG"} (tx)`,
        quote.attachedBracket?.evm?.approveTx && `approve ${target.symbol} for exits (tx)`,
        nonEmpty(quote.evm.permitTypedData) && "Permit2 (signature)",
        "order (signature)",
        quote.attachedBracket?.evm && "take-profit / stop-loss (signature)",
      ].filter(Boolean)
    : [];

  return (
    <Shell
      title="Make it real"
      kicker="JACKTRADE / AGENTS"
      subtitle="Copy an agent's bet into the real token on Robinhood Chain with a Definitive Flash order. Your wallet, your tokens."
    >
      <div className="jt-grok">
        <p className="jt-small">
          <Link to="/bets">← Agent bets</Link>
        </p>

        <Panel title="The agent's bet">
          {bet ? (
            <dl className="jt-kv">
              <div><dt>Market</dt><dd>{betSymbol || bet.market}</dd></div>
              <div><dt>Side</dt><dd className={isLong(bet.side) ? "pm-up" : "pm-down"}>{isLong(bet.side) ? "LONG" : "SHORT"}</dd></div>
              <div><dt>Leverage</dt><dd>{bet.leverage}×</dd></div>
              <div><dt>Entry</dt><dd>{bet.entryPrice ? fmtPrice(bet.entryPrice) : "–"}</dd></div>
              <div><dt>Margin</dt><dd>{fmtUsd(bet.marginUsd)}</dd></div>
              <div><dt>Placed</dt><dd>{timeAgo(bet.openedAt) || "–"}</dd></div>
            </dl>
          ) : betErr ? (
            <Note>
              Couldn't load bet <span className="jt-mono">{id}</span> ({betErr}). You can still set up an order below.
            </Note>
          ) : (
            <p className="jt-muted">Loading bet…</p>
          )}
          {mapping.note && bet && <p className="jt-small jt-muted">{mapping.note}</p>}
        </Panel>

        <Panel title="Your order">
          <div className="jt-form">
            <label>
              <span>Buy (real token)</span>
              <select className="jt-input" value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>
                <option value="TSLA">TSLA (Tesla stock token)</option>
                <option value="NVDA">NVDA (Nvidia stock token)</option>
                <option value="ETH">WETH (wrapped ETH)</option>
              </select>
            </label>
            <label>
              <span>Strategy</span>
              <select className="jt-input" value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="long">Long → market buy + take-profit / stop-loss</option>
                <option value="short">Short → limit buy below the market</option>
              </select>
            </label>
            <label>
              <span>Pay with</span>
              <select className="jt-input" value={payWith} onChange={(e) => setPayWith(e.target.value)}>
                <option value="USDG">USDG</option>
                <option value="ETH" disabled={targetKey === "ETH"}>
                  ETH (native){targetKey === "ETH" ? " (n/a for WETH)" : ""}
                </option>
              </select>
            </label>
            {payWith === "USDG" ? (
              <label>
                <span>Amount (USDG)</span>
                <input className="jt-input" type="number" min="1" step="1" value={usdAmount} onChange={(e) => setUsdAmount(e.target.value)} />
              </label>
            ) : (
              <label>
                <span>Amount (ETH)</span>
                <input className="jt-input" type="number" min="0" step="0.001" value={ethAmount} onChange={(e) => setEthAmount(e.target.value)} />
              </label>
            )}
          </div>

          <div className="jt-row">
            <span className="jt-muted">{target.symbol} now</span>
            <strong className="jt-mono">{refPrice ? `$${fmtPrice(refPrice)}` : priceErr ? "–" : "…"}</strong>
            <button className="luna-btn" type="button" onClick={loadPrice}>
              Refresh
            </button>
            <span className="jt-small jt-muted">
              From the bet's {leverage}× leverage: liquidation distance ≈ {(liqPct * 100).toFixed(2)}%
            </span>
          </div>
          <ErrorBox error={priceErr} />

          {direction === "long" ? (
            <div className="jt-form">
              <label>
                <span>Take-profit (USD)</span>
                <input className="jt-input" type="number" step="0.01" value={tp} onChange={(e) => setTp(e.target.value)} />
              </label>
              <label>
                <span>Stop-loss (USD)</span>
                <input className="jt-input" type="number" step="0.01" value={sl} onChange={(e) => setSl(e.target.value)} />
              </label>
              <label>
                <span>Max slippage % (blank = recommended)</span>
                <input className="jt-input" type="number" step="0.1" min="0" placeholder="auto" value={maxSlippagePct} onChange={(e) => setMaxSlippagePct(e.target.value)} />
              </label>
            </div>
          ) : (
            <div className="jt-form">
              <label>
                <span>Limit buy price (USD)</span>
                <input className="jt-input" type="number" step="0.01" value={limitPx} onChange={(e) => setLimitPx(e.target.value)} />
              </label>
              <p className="jt-small jt-muted">
                The short bets on a drop. This rests a limit buy at that level (good-til-cancelled), so you pick up the
                real token if the agent is right.
              </p>
            </div>
          )}

          {!account ? (
            <button className="luna-btn luna-btn-active" type="button" onClick={wallet.connect}>
              Connect wallet
            </button>
          ) : (
            <div className="jt-row">
              <button className="luna-btn luna-btn-active" type="button" onClick={getQuote} disabled={quoteBusy || execBusy}>
                {quoteBusy ? "Quoting…" : quote ? "Re-quote" : "Get Flash quote"}
              </button>
              {balances && (
                <span className="jt-small jt-muted">
                  Wallet: {balances.usdg.toFixed(2)} USDG · {balances.eth.toFixed(5)} ETH
                </span>
              )}
            </div>
          )}
          {lowUsdg && <Note>Your wallet has less USDG than this order spends.</Note>}
          <ErrorBox error={quoteErr} />

          {quote && (
            <div className="jt-quote">
              <dl className="jt-kv">
                <div><dt>You spend</dt><dd>{quote.from?.amount} {spendLabel} ({fmtUsd(quote.from?.notional)})</dd></div>
                <div><dt>You get (est.)</dt><dd>{Number(quote.to?.amount).toPrecision(6)} {target.symbol} ({fmtUsd(quote.to?.notional)})</dd></div>
                <div><dt>Fees (est.)</dt><dd>{fmtUsd(quote.fees?.estimatedFeeNotional, 4)}</dd></div>
                {quote.estimatedPriceImpact != null && (
                  <div><dt>Price impact</dt><dd>{(Number(quote.estimatedPriceImpact) * 100).toFixed(3)}%</dd></div>
                )}
                {quote.recommendedSlippage != null && (
                  <div>
                    <dt>Slippage</dt>
                    <dd>
                      {quoteBody?.maxSlippage
                        ? `${(Number(quoteBody.maxSlippage) * 100).toFixed(2)}% (yours)`
                        : `${(Number(quote.recommendedSlippage) * 100).toFixed(2)}% (recommended)`}
                    </dd>
                  </div>
                )}
                {quoteBody?.attachedBracket && (
                  <div>
                    <dt>Bracket</dt>
                    <dd>TP ${quoteBody.attachedBracket.takeProfit.notionalPrice} / SL ${quoteBody.attachedBracket.stopLoss.notionalPrice}</dd>
                  </div>
                )}
                {quoteBody?.limitNotionalPrice && (
                  <div><dt>Limit</dt><dd>${quoteBody.limitNotionalPrice} (good-til-cancelled)</dd></div>
                )}
              </dl>
              <p className="jt-small jt-muted">Wallet prompts: {prompts.join(" → ")}</p>
              <button className="luna-btn luna-btn-active" type="button" onClick={execute} disabled={execBusy}>
                {execBusy ? "Follow your wallet…" : "Place order"}
              </button>
            </div>
          )}

          {log.length > 0 && (
            <ol className="jt-exec-log">
              {log.map((s) => (
                <li key={s.key} className={`jt-exec-${s.state}`}>
                  <span className="jt-exec-dot">{s.state === "done" ? "✓" : s.state === "error" ? "✕" : "…"}</span>
                  <span>{s.label}</span>
                  {s.hash && (
                    <span className="jt-small">
                      <TxHash hash={s.hash} />
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          <ErrorBox error={execErr} />
        </Panel>

        {orderId && (
          <Panel title="Order status">
            <dl className="jt-kv">
              <div><dt>Order id</dt><dd className="jt-mono jt-selectable">{orderId}</dd></div>
              <div><dt>Status</dt><dd className={statusTone(myOrder?.status)}>{myOrder ? statusLabel(myOrder.status) : "Submitted…"}</dd></div>
              {myOrder?.filled && Number(myOrder.filled.targetAmount) > 0 && (
                <div>
                  <dt>Filled</dt>
                  <dd>{Number(myOrder.filled.targetAmount).toPrecision(6)} {target.symbol} @ ${fmtPrice(myOrder.filled.averageNotionalPrice)}</dd>
                </div>
              )}
              {myOrder?.closeReason && <div><dt>Reason</dt><dd>{myOrder.closeReason}</dd></div>}
              {myOrder?.attachedBracket && (
                <div>
                  <dt>Bracket</dt>
                  <dd>{myOrder.attachedBracket.status}{bracketOrder ? ` · ${statusLabel(bracketOrder.status)}` : ""}</dd>
                </div>
              )}
            </dl>
            {fills.map((f, i) => (
              <p key={i} className="jt-small">
                Fill {fmtUsd(f.notional)} @ {fmtPrice(f.fillPrice)} · <TxHash hash={f.transactionId} />
              </p>
            ))}
          </Panel>
        )}

        {account && orders.length > 0 && (
          <Panel title="Your recent Flash orders">
            <div className="pm-table-scroll">
              <table className="pm-table">
                <thead>
                  <tr><th>Order</th><th>Type</th><th>Token</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {orders.slice(0, 8).map((o) => (
                    <tr key={o.orderId}>
                      <td className="jt-mono">{short(o.orderId, 4)}</td>
                      <td>{o.orderType} {o.side}</td>
                      <td>{o.targetAsset?.ticker || short(o.targetAsset?.address || "")}</td>
                      <td className={statusTone(o.status)}>{statusLabel(o.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </Shell>
  );
}
