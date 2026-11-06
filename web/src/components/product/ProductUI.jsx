import { createWalletClient, custom } from "viem";
import { ProductUIContext } from "./ProductUIContext";
import { lazy, Suspense, useContext, useId, useState, useRef, useEffect } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  X,
  ArrowUpRight,
  HelpCircle,
  Copy,
  Download,
  Globe,
  Menu,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Wallet,
  Check,
} from "lucide-react";
import { useTradingSession } from "@/hooks/useTradingSession";
import { JacktradeWordmark, JacktradeSparkle } from "@/components/jacktrade/JacktradeLogo";
import { money } from "@/lib/protocolModel";
import CollateralIcon from "@/components/product/CollateralIcon";
import { ThemeToggle, useTheme } from '@/components/dream/ThemeProvider';
// Trustware (deposits from other chains) only loads when that option is opened, and only shows with an API key.
const CrossChainDeposit = lazy(() => import("./CrossChainDeposit"));
const CROSS_CHAIN_DEPOSITS = !!import.meta.env?.VITE_TRUSTWARE_API_KEY;
import { claimUsername, fetchProfile, fetchProfileByUsername } from "@/lib/jacktradeApi";
import { APPKIT_PROJECT_ID, pickWallet, rememberWallet } from "@/lib/appkit";
import { API_URL } from "@/lib/backend";
import { usePolledData } from "@/hooks/useBackendAccount";

// Same rule as the profiles API: 3-24 lowercase letters, numbers, ".", "-" or "_", starting with a letter or number.
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,23}$/;
export function usernameError(error) {
  if (error?.code === 4001) return "Signature cancelled in your wallet.";
  return {
    INVALID_USERNAME: error?.message || "Use 3–24 lowercase letters, numbers, dots, hyphens or underscores.",
    USERNAME_TAKEN: "This username is already taken. Try another one.",
    INVALID_SIGNATURE: "The signature does not belong to the connected wallet. Sign again with that wallet.",
    CHALLENGE_EXPIRED: "The signature request expired. Save again to sign a new one.",
    CHANGE_TOO_SOON: error?.message || "You can change your username once every 24 hours.",
    RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  }[error?.code] || error?.message || "The username could not be saved. Try again.";
}
// The provider picked in the wallet list, so the username signature goes to the same wallet.
let selectedProvider = null;

export const useProductUI = () => useContext(ProductUIContext);
export function ProductUIProvider({ children }) {
  const [modal, showModal] = useState(null);
  const [notice, setNotice] = useState("");
  const { account } = useTradingSession();
  // A cross-chain deposit on its way: once USDG lands in the wallet (Trustware's status or the balance going up,
  // whichever comes first), open the deposit with the amount ready. Works with the sheet closed too.
  const [incoming, setIncoming] = useState(null);
  const landed = () => {
    setIncoming(null);
    account.refresh?.();
    setNotice("USDG arrived in your wallet. Deposit it to start trading.");
    showModal({ type: "deposit-trade", robinhood: true });
  };
  // The bridge sheet runs the deposit itself while it is open; this only covers a sheet closed early.
  useEffect(() => {
    if (!incoming || modal?.type === "bridge") return;
    if (account.availableMargin > incoming.exchange + 0.05) {
      // Deposited straight into the Exchange by the route: nothing left to do.
      setIncoming(null);
      setNotice("Deposit complete: your USDG are in your trading account.");
    } else if (account.walletBalance > incoming.from + 0.5) landed();
    // landed changes every render; it only reads the latest account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming, modal?.type, account.availableMargin, account.walletBalance]);
  // With a Reown project, "Connect wallet" opens AppKit's picker; the chosen wallet then goes through the usual connect.
  const setModal = (next) => {
    if (next?.type !== "wallet" || !APPKIT_PROJECT_ID) return showModal(next);
    showModal(null);
    pickWallet()
      .then(async (provider) => {
        await account.connect(provider);
        selectedProvider = provider;
        rememberWallet(true);
        setNotice("Wallet connected to Robinhood Chain.");
      })
      .catch((reason) => { if (reason?.code !== 4001) setNotice(reason?.message || "The wallet could not connect."); });
  };
  const [language, setLanguage] = useState("en");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4200);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <ProductUIContext.Provider
      value={{ modal, setModal, notice, notify: setNotice, language, setLanguage }}
    >
      {children}
      {modal?.type === "bridge"
        ? <BridgeSheet close={() => showModal(null)} back={() => showModal({ type: "deposit-trade" })} notify={setNotice} onSent={() => setIncoming({ from: account.walletBalance, exchange: account.availableMargin })} />
        : modal && <Modal key={modal.type} value={modal} close={() => showModal(null)} />}
      <div role="status" className={`pm-toast ${notice ? "is-visible" : ""}`}>
        {notice}
      </div>
    </ProductUIContext.Provider>
  );
}
const NAV = [
  ["Trade", "/trade"],
  ["Portfolio", "/portfolio"],
  ["House", "/house"],
  ["Token", "/token"],
  ["Leaderboard", "/leaderboard"],
];
const LABELS = {
  en: ["Trade", "Portfolio", "House", "Token", "Leaderboard"],
  es: ["Operar", "Portfolio", "Casa", "Token", "Leaderboard"],
  pt: ["Operar", "Portfolio", "Casa", "Token", "Leaderboard"],
  zh: ["交易", "资产", "庄家", "代币", "排行"],
};
function MoreMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const toggle = useRef(null);
  const { pathname } = useLocation();
  const { language, setModal } = useProductUI();
  useEffect(() => {
    if (!open) return;
    const dismiss = (event) => {
      if (event.type === "keydown") {
        if (event.key !== "Escape") return;
        setOpen(false);
        toggle.current?.focus();
      } else if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open]);
  return (
    <div className="pm-more" ref={ref}>
      <button
        ref={toggle}
        type="button"
        className="hm-nav-tab pm-nav pm-more-toggle"
        aria-label="More"
        aria-expanded={open}
        aria-controls="header-more-links"
        data-active={pathname === "/help" || pathname === "/docs" ? "true" : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="hm-nav-en">
          {{ en: "More", es: "Más", pt: "Mais", zh: "更多" }[language]}
        </span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div id="header-more-links" className="pm-more-links" role="region" aria-label="More links">
          <Link to="/docs" onClick={() => setOpen(false)}>
            Docs <ArrowUpRight size={12} />
          </Link>
          <Link to="/docs" hash="faq" onClick={() => setOpen(false)}>
            FAQ <ArrowUpRight size={12} />
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setModal({ type: "support" });
            }}
          >
            Support <ArrowUpRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
export function Header() {
  const { walletConnected, walletAddress, account, username } = useTradingSession();
  const { pathname } = useLocation();
  const { setModal, language } = useProductUI();
  return (
    <header className="pd-header">
      <Link to="/" className="pd-header-brand" aria-label="JackTrade home">
        <JacktradeWordmark />
        <JacktradeSparkle className="dream-brand-sparkle" />
      </Link>
      <nav className="pd-header-nav" aria-label="Main navigation">
        {NAV.map(([name, to], i) => (
          <Link
            key={to}
            to={to}
            aria-label={name}
            aria-current={pathname === to ? "page" : undefined}
          >
            {LABELS[language][i]}
          </Link>
        ))}
        <MoreMenu />
      </nav>
      <span
        className={`pd-header-demo ${account.protocol?.config ? "is-live" : ""}`}
        title={account.protocol?.config ? "Robinhood Chain" : "Connecting to Robinhood Chain…"}
        role="img"
        aria-label={account.protocol?.config ? "Robinhood Chain" : "Connecting to Robinhood Chain"}
      >
        <img src="/logos/robinhood-chain.svg" alt="" />
      </span>
      <div className="pd-header-actions">
        <ThemeToggle />
        <button
          className="pd-header-language"
          aria-label="Language"
          onClick={() => setModal({ type: "settings" })}
        >
          <Globe size={16} />
        </button>
        <button
          onClick={() =>
            setModal(walletConnected ? { type: "deposit-trade" } : { type: "wallet" })
          }
        >
          Deposit
        </button>
        <button
          onClick={() =>
            setModal(walletConnected ? { type: "funds", withdraw: true } : { type: "wallet" })
          }
        >
          Withdraw
        </button>
        {walletConnected ? (
          <span className="pd-header-connected">
            <i />
            {username || (walletAddress ? `${walletAddress.slice(0,6)}…${walletAddress.slice(-4)}` : "Connected")}
          </span>
        ) : (
          <button onClick={() => setModal({ type: "wallet" })}>Connect</button>
        )}
        <button
          aria-label="Settings"
          title="Settings"
          onClick={() => setModal({ type: "settings" })}
        >
          <Menu size={16} />
        </button>
      </div>
    </header>
  );
}
// Positions, history and balances come from the indexer. When it runs behind the chain, say so: otherwise a fresh
// trade, deposit or liquidation looks lost. The chain clock itself runs a few seconds behind, hence the margin.
const fetchIndexerTime = () =>
  fetch(`${API_URL}/status`, { signal: AbortSignal.timeout(8_000) })
    .then((res) => res.json())
    .then((body) => Number(Object.values(body)[0]?.block?.timestamp ?? 0));
function IndexerLagNotice() {
  const { data: blockTime } = usePolledData("indexer-status", fetchIndexerTime, 15_000);
  const behind = blockTime ? Date.now() / 1000 - blockTime : 0;
  if (behind < 45) return null;
  const minutes = Math.max(1, Math.round(behind / 60));
  return (
    <div className="pm-lag-notice" role="status">
      <Loader2 size={13} className="pm-spin" aria-hidden="true" />
      <span>
        Activity is catching up: new trades, history and balances can show up to {minutes} min late. Everything is
        already settled on-chain.
      </span>
    </div>
  );
}
export function Shell({ children, title, kicker, subtitle, action, trade = false, dashboard }) {
  const pageTitle =
    { house: "House", token: "HOUSE", portfolio: "Portfolio", leaderboard: "Leaderboard" }[
      dashboard
    ] || title;
  return (
    <div
      className={`hm-workstation sky86 hm-focus pm-workstation ${trade ? "pd-trade" : ""} relative min-h-screen overflow-x-hidden`}
    >
      <main className="hm-stage">
        <div className="hm-app-window">
          <Header />
          <IndexerLagNotice />
          {dashboard && dashboard !== "public-profile" && <h1 className="sr-only">{pageTitle}</h1>}
          {title && (!dashboard || dashboard === "public-profile" || action) && (
            <div className={`pm-page-heading ${dashboard ? "pm-dashboard-heading" : ""}`}>
              {dashboard ? (
                dashboard === "public-profile" && <h1>{pageTitle}</h1>
              ) : (
                <div>
                  <span className="pm-eyebrow">{kicker || "JACKTRADE / ROBINHOOD CHAIN"}</span>
                  <h1>{title}</h1>
                  {subtitle && <p>{subtitle}</p>}
                </div>
              )}
              {action}
            </div>
          )}
          {dashboard ? (
            <div className={`pm-dashboard-content pm-dashboard-${dashboard}`}>{children}</div>
          ) : (
            children
          )}
          {!trade && !dashboard && (
            <footer className="pm-footer">
              <span>
                <i /> ROBINHOOD CHAIN · LIVE PROTOCOL DATA
              </span>
              <Link to="/docs">Docs ↗</Link>
              <span>JACKTRADE / TRADING INTERFACE</span>
            </footer>
          )}
        </div>
      </main>
    </div>
  );
}
export function Panel({ title, aside, children, className = "", collapsible = false }) {
  const heading = (
    <>
      <h2>{title}</h2>
      {aside}
    </>
  );
  if (collapsible)
    return (
      <details className={`hm-panel pm-panel pm-panel-disclosure ${className}`}>
        <summary className="pm-panel-heading hm-panel-bar">{heading}</summary>
        <div className="pm-panel-body">{children}</div>
      </details>
    );
  return (
    <section className={`hm-panel pm-panel ${className}`}>
      <div className="pm-panel-heading hm-panel-bar">{heading}</div>
      <div className="pm-panel-body">{children}</div>
    </section>
  );
}
export function Metric({ label, value, detail, tone = "" }) {
  return (
    <div className={`pm-metric ${tone}`}>
      <span>
        {label}
        {detail && <Hint text={detail} />}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
export function Hint({ text }) {
  return (
    <span className="pm-hint" tabIndex="0" role="note" aria-label={text}>
      <HelpCircle size={12} />
      <span>{text}</span>
    </span>
  );
}
export function Tabs({ items, value, onChange, label }) {
  return (
    <div className="pm-tabs" role="tablist" aria-label={label || "View"}>
      {items.map(([id, text]) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          className={`luna-btn ${value === id ? "luna-btn-active" : ""}`}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
// The app's dropdown: a trigger plus a menu styled like the chart menus (never the browser's native list).
// items: [id, text, icon?, note?]; icon is any node (a market logo, say), note a small grey tag ("Preview").
export function FilterSelect({ items, value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const trigger = useRef(null);
  const list = useRef(null);
  const uid = useId();
  const current = items.find(([id]) => id === value) ?? items[0];
  useEffect(() => {
    if (!open) return;
    const dismiss = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    list.current?.focus();
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const show = () => { setActive(Math.max(0, items.findIndex(([id]) => id === value))); setOpen(true); };
  const choose = (id) => { setOpen(false); trigger.current?.focus(); if (id !== value) onChange(id); };
  const onKey = (event) => {
    if (event.key === "Escape" || event.key === "Tab") { setOpen(false); if (event.key === "Escape") trigger.current?.focus(); return; }
    const moves = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: items.length - 1 };
    if (event.key in moves) { event.preventDefault(); setActive((moves[event.key] + items.length) % items.length); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(items[active][0]); }
  };
  return (
    <div className={`pm-filter-select ${open ? "is-open" : ""}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        className="pm-select-trigger"
        aria-label={`${label}: ${current?.[1] ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); } }}
      >
        {current?.[2] && <span className="pm-select-icon">{current[2]}</span>}
        <span className="pm-select-value">{current?.[1]}</span>
      </button>
      <ChevronDown size={13} aria-hidden="true" />
      {open && (
        <ul
          ref={list}
          className="pm-chart-menu pm-select-menu"
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${uid}-${active}`}
          onKeyDown={onKey}
        >
          {items.map(([id, text, icon, note], index) => (
            <li
              key={id}
              id={`${uid}-${index}`}
              role="option"
              aria-selected={id === value}
              className={`${index === active ? "is-active" : ""} ${id === value ? "is-selected" : ""}`}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(id)}
            >
              {icon && <span className="pm-select-icon">{icon}</span>}
              <span>{text}</span>
              {note && <small>{note}</small>}
              {id === value && <Check size={13} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export function LinePlot({
  values,
  labels = [],
  height = 160,
  markers = [],
  ariaLabel = "Chart",
  unit = "USDG",
}) {
  const min = Math.min(...values),
    max = Math.max(...values),
    range = max - min || 1;
  const yAt = (value) =>
    max === min ? height / 2 : height - 25 - ((value - min) / range) * (height - 50);
  const points = values
    .map((v, i) => `${20 + (i / Math.max(1, values.length - 1)) * 660},${yAt(v)}`)
    .join(" ");
  return (
    <div className="pm-plot">
      <svg viewBox={`0 0 700 ${height}`} role="img" aria-label={ariaLabel}>
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1="20"
            x2="680"
            y1={25 + (i * (height - 50)) / 3}
            y2={25 + (i * (height - 50)) / 3}
            stroke="#443c5066"
            strokeDasharray="3 5"
          />
        ))}
        <polyline
          points={points}
          fill="none"
          stroke="#254a87"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {markers.map((m, i) => (
          <g key={i}>
            <circle
              cx={20 + (m.index / Math.max(1, values.length - 1)) * 660}
              cy={yAt(values[m.index])}
              r="4"
              fill={m.loss ? "#c85c67" : "#2d9562"}
            />
            <title>{m.label}</title>
          </g>
        ))}
      </svg>
      <div className="pm-plot-scale">
        <span>
          {money(max)} {unit}
        </span>
        <span>
          {money(min)} {unit}
        </span>
      </div>
      <div className="pm-plot-labels">
        {labels.map((x) => (
          <span key={x}>{x}</span>
        ))}
      </div>
    </div>
  );
}
/** Close a position: what comes back now, the PnL, and any profit that waits in the payout queue. */
function ClosePosition({ id, close }) {
  const { account } = useTradingSession();
  const { notify } = useProductUI();
  const position = account.positions.find((p) => String(p.id) === String(id));
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => account.previewPosition(id).then((p) => live && setPreview(p)).catch((reason) => live && setError(reason.message));
    load();
    const timer = setInterval(load, 3000); // PnL moves with the price
    return () => { live = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  async function confirm() {
    setBusy(true); setError("");
    const result = await account.closePosition(id);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else { notify(`Position #${id} closed.`); close(); }
  }
  const pnl = Number(preview?.pnl ?? position?.pnl ?? 0);
  const queued = Number(preview?.queued ?? 0);
  return (
    <div className="pm-deposit-source">
      {position && (
        <div className="pm-close-head">
          <strong>{position.symbol?.replace("-PERP", "")} {position.side} {money(position.leverage, 0)}×</strong>
          <small>${money(position.notional, 0)} position · entry {money(position.entry)}</small>
        </div>
      )}
      <dl className="pm-xc-quote">
        <div><dt>PnL</dt><dd className={pnl >= 0 ? "pm-up" : "pm-down"}>{preview ? `${pnl >= 0 ? "+" : "−"}${money(Math.abs(pnl))} USDG` : "…"}</dd></div>
        <div><dt>Back to your balance now</dt><dd>{preview ? `${money(Number(preview.returned))} USDG` : "…"}</dd></div>
        {queued > 0 && <div><dt>Profit in the payout queue</dt><dd>{money(queued)} USDG</dd></div>}
      </dl>
      <button className="pm-sheet-primary" onClick={confirm} disabled={busy || !position}>
        {busy ? "Closing…" : "Close position"}
      </button>
      <p className="pm-sheet-note">
        {error || (queued > 0
          ? "The house pays profits from its bankroll; when it runs short, your profit waits in the queue and is paid in order as funds come in."
          : "Closes at the market price, with your session key: no wallet prompt.")}
      </p>
    </div>
  );
}
/** Smallest deposit the Exchange accepts: minDeposit, plus the one-time activation fee on a wallet's first deposit. */
export function depositMinimum(account, limits) {
  const minDeposit = Number(limits?.minDeposit ?? 10);
  const fee = account.activated === false ? Number(limits?.activationFee ?? 1) : 0;
  return { minDeposit, fee, minimum: minDeposit + fee };
}
// Trustware's widget on its own, outside the app's modal styles: a bare dialog with Back and Close above the card.
function BridgeSheet({ close, back, notify, onSent }) {
  const ref = useRef(null);
  const { account, walletAddress, protocolLimits } = useTradingSession();
  const { theme } = useTheme() ?? {};
  const [error, setError] = useState("");
  useEffect(() => { ref.current.showModal(); }, []);
  return (
    <dialog
      ref={ref}
      className={`pm-bridge pm-sheet${theme === "dark" ? " is-dark" : ""}`}
      aria-label="Deposit from any chain or asset"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === ref.current) close(); }}
    >
      <button type="button" className="pm-bridge-close" aria-label="Close dialog" onClick={close}><X size={18} /></button>
      <Suspense fallback={<div className="pm-bridge-loading">Loading…</div>}>
        <CrossChainDeposit
          provider={account.walletProvider}
          address={walletAddress}
          minimumUsdg={depositMinimum(account, protocolLimits).minimum}
          onExit={back}
          walletBalance={account.walletBalance}
          exchangeBalance={account.availableMargin}
          onDone={close}
          onSent={onSent}
          onArrived={() => account.refresh?.()}
          onDeposit={async (amount) => {
            const result = await account.transfer(amount, false);
            if (!result.ok) return result;
            try {
              await account.enableSession();
            } catch (reason) {
              return { ok: false, error: `Deposited. Trading still needs one signature: ${reason.message}` };
            }
            notify("Deposit complete. You're ready to trade.");
            close();
            return { ok: true };
          }}
          onError={setError}
        />
      </Suspense>
      {error && <p className="pm-bridge-note">{error}</p>}
    </dialog>
  );
}
// Amount input for deposits and withdrawals: one box with the USDG chip and a Max shortcut, balance underneath.
function AmountField({ value, onChange, balance, balanceLabel }) {
  return (
    <div className="pm-amount">
      <div className="pm-amount-box">
        <span className="pm-amount-chip"><CollateralIcon size={16} /> USDG</span>
        <input autoFocus type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" aria-label="Amount in USDG" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
      <div className="pm-amount-meta">
        <span>{money(balance)} USDG {balanceLabel}</span>
        <button type="button" onClick={() => onChange(String(Math.floor(balance * 100) / 100))} disabled={!(balance > 0)}>Max</button>
      </div>
    </div>
  );
}
function Modal({ value, close }) {
  const ref = useRef(null);
  const { account, setWalletConnected, walletConnected, walletAddress, username: ownUsername, setUsername: setOwnUsername, protocolLimits } = useTradingSession();
  const { minimum: minDeposit, fee: activationFee } = depositMinimum(account, protocolLimits);
  const { notify, setModal, language, setLanguage } = useProductUI();
  const [wallets, setWallets] = useState([]);
  const [walletsScanned, setWalletsScanned] = useState(false);
  const [connecting, setConnecting] = useState(null);
  // value.robinhood: straight to the Robinhood Chain amount, prefilled with the whole wallet balance (after a bridge).
  const [depositOpen, setDepositOpen] = useState(value.robinhood === true);
  const [amount, setAmount] = useState(value.robinhood ? String(Math.floor(account.walletBalance * 100) / 100) : "10");
  const withdraw = value.type === "funds"; // "funds" is the withdraw sheet; deposits go through "deposit-trade"
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value.type !== "username" || !walletAddress) return;
    let live = true;
    fetchProfile(walletAddress)
      .then((next) => {
        if (!live) return;
        setProfile(next);
        setUsername(next.username || "");
      })
      .catch((reason) => {
        if (!live) return;
        setProfile({ username: null });
        setError(`Your current username could not be loaded. ${reason.message}`);
      });
    return () => {
      live = false;
    };
  }, [value.type, walletAddress]);
  // Live check while typing: free, taken by another wallet, or already this wallet's.
  const [availability, setAvailability] = useState({ name: "", status: "idle" });
  useEffect(() => {
    if (value.type !== "username" || !walletAddress) return;
    const name = username;
    if (!USERNAME_PATTERN.test(name) || /^0x[0-9a-f]*$/.test(name) || name === profile?.username) return;
    let active = true;
    const timer = setTimeout(() => {
      fetchProfileByUsername(name)
        .then((owner) => active && setAvailability({ name, status: owner.wallet?.toLowerCase() === walletAddress.toLowerCase() ? "mine" : "taken" }))
        .catch((reason) => active && setAvailability({ name, status: reason.code === "PROFILE_NOT_FOUND" || reason.status === 404 ? "free" : "idle" }));
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [value.type, username, walletAddress, profile?.username]);
  const nameIssue = username && (!USERNAME_PATTERN.test(username) || /^0x[0-9a-f]*$/.test(username))
    ? "3–24 lowercase letters, numbers, dots, hyphens or underscores, starting with a letter or number."
    : null;
  const nameStatus = !username || username === profile?.username ? null
    : nameIssue ? { tone: "bad", text: nameIssue }
    : availability.name !== username ? { tone: "wait", text: "Checking…" }
    : availability.status === "taken" ? { tone: "bad", text: `@${username} is taken. Try another one.` }
    : availability.status === "free" || availability.status === "mine" ? { tone: "good", text: `@${username} is available.` }
    : null;
  async function saveUsername() {
    setError("");
    if (!USERNAME_PATTERN.test(username) || /^0x[0-9a-f]*$/.test(username)) {
      setError("Use 3–24 lowercase letters, numbers, dots, hyphens or underscores, starting with a letter or number.");
      return;
    }
    if (username === profile?.username) {
      close();
      return;
    }
    setBusy(true);
    try {
      const provider = selectedProvider ?? window.ethereum;
      const walletClient = account.walletClient ?? (provider && createWalletClient({ transport: custom(provider) }));
      if (!walletClient) throw new Error("No wallet available to sign. Reconnect your wallet.");
      const saved = await claimUsername(walletClient, walletAddress, username);
      setProfile(saved);
      setOwnUsername(saved.username);
      value.onSaved?.(saved);
      notify(`Username saved: ${saved.username}`);
      close();
    } catch (reason) {
      setError(usernameError(reason));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    ref.current.showModal();
  }, []);
  useEffect(() => {
    if (value.type !== "wallet") return;
    const found = new Map();
    const add = (detail) => {
      if (!detail?.provider) return;
      // One row per wallet: the same wallet can announce twice (two uuids, or 6963 plus the legacy window.ethereum).
      if ([...found.values()].some((item) => item.provider === detail.provider || item.info?.name === detail.info?.name)) return;
      const key = detail.info?.uuid || detail.info?.rdns || detail.info?.name || String(found.size);
      found.set(key, detail);
      setWallets([...found.values()]);
    };
    const announced = (event) => add(event.detail);
    window.addEventListener("eip6963:announceProvider", announced);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // Older wallets only inject window.ethereum: listed only when no wallet announced itself (EIP-6963).
    const legacyTimer = setTimeout(() => {
      setWalletsScanned(true);
      if (found.size) return;
      const legacy = window.ethereum?.providers?.length ? window.ethereum.providers : window.ethereum ? [window.ethereum] : [];
      legacy.forEach((provider, index) => add({
        provider,
        info: {
          uuid: `legacy-${index}`,
          name: provider.isRabby ? "Rabby Wallet" : provider.isOkxWallet ? "OKX Wallet" : provider.isTrust ? "Trust Wallet" : provider.isPhantom ? "Phantom" : provider.isMetaMask ? "MetaMask" : "Browser Wallet",
        },
      }));
    }, 250);
    return () => { clearTimeout(legacyTimer); window.removeEventListener("eip6963:announceProvider", announced); };
  }, [value.type]);
  const connectWallet = async (provider, name) => {
    setError("");
    setBusy(true);
    setConnecting(name);
    try {
      await account.connect(provider);
      selectedProvider = provider;
      notify("Wallet connected to Robinhood Chain.");
      close();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
      setConnecting(null);
    }
  };
  async function transfer() {
    setError("");
    setBusy(true);
    const r = await account.transfer(Number(amount), withdraw);
    if (!r.ok) setError(r.error);
    else {
      notify(`${withdraw ? "Withdrawal" : "Deposit"} executed on Robinhood Chain.`);
      if (value.type === "deposit-trade" && !withdraw) {
        try {
          await account.enableSession();
          notify("Deposit complete. Trading is ready.");
          close();
        } catch (reason) {
          setError(`Your deposit completed, but trading authorization still needs a signature. ${reason.message}`);
        }
      } else close();
    }
    setBusy(false);
  }
  const title = {
    wallet: "Connect a wallet",
    "deposit-trade": "Deposit",
    settings: "Settings",
    support: "Support",
    funds: "Withdraw",
    close: "Close position",
    session: "Session & limits",
    username: "Claim your identity",
    share: "Your JackTrade card",
  }[value.type];
  const share = value.data || {};
  const shareColor = share.tone === "up" ? "#2d9562" : share.tone === "down" ? "#c85c67" : "#c9b6df";
  // Built only from the real numbers the caller passes (or the connected account's realized PnL).
  const shareTitle = share.title || ownUsername || (walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : "jacktrade");
  const shareValue = share.value || "$" + money(account.history.reduce((s, p) => s + p.pnl, 0));
  const shareDetail = share.detail || "YOUR TRADES. YOUR HOUSE.";
  const shareText = `JackTrade · ${shareTitle} · ${shareValue} · ${shareDetail}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(shareText);
      notify("Copied your card text.");
    } catch {
      setError("Clipboard unavailable. Select and copy the card text.");
    }
  }
  function download() {
    const escape = (s) =>
      String(s).replace(
        /[<>&"']/g,
        (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c],
      );
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#100d16"/><rect x="30" y="30" width="1140" height="570" fill="none" stroke="#7d6296"/><g fill="#c9b6df" font-family="monospace"><text x="80" y="110" font-size="32">jacktrade</text><text x="80" y="230" font-size="28">${escape(shareTitle)}</text><text x="80" y="355" font-size="82" fill="${shareColor}">${escape(shareValue)}</text><text x="80" y="445" font-size="24">${escape(shareDetail)}</text><text x="80" y="550" font-size="20">ON-CHAIN DATA / ROBINHOOD CHAIN</text></g></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "jacktrade-card.svg";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <dialog
      ref={ref}
      className={`pm-modal pm-modal-${value.type}${["wallet", "deposit-trade", "funds", "close"].includes(value.type) ? " pm-sheet" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="pm-modal-heading">
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <div className="pm-modal-body">
        {value.type === "support" && (
          <>
            <p>Find answers about trading, balances and your session.</p>
            <div className="pm-settings-options">
              <Link className="luna-btn" to="/docs" hash="faq" onClick={close}>
                FAQ <ArrowUpRight size={12} />
              </Link>
              <Link className="luna-btn" to="/docs" onClick={close}>
                Documentation <ArrowUpRight size={12} />
              </Link>
              <button className="luna-btn" onClick={() => setModal({ type: "session" })}>
                Session & limits <ArrowUpRight size={12} />
              </button>
            </div>
          </>
        )}
        {value.type === "settings" && (
          <>
            <div className="pm-field">
              Navigation language
              <FilterSelect
                label="Navigation language"
                value={language}
                onChange={setLanguage}
                items={[["en", "English"], ["es", "Español"], ["pt", "Português"], ["zh", "中文"]]}
              />
            </div>
            {walletConnected ? (
              <div className="pm-settings-options">
                <button className="luna-btn pm-settings-withdraw" onClick={() => setModal({ type: "funds", withdraw: true })}>
                  <span>
                    Withdraw <ArrowUpRight size={12} />
                  </span>
                  <small>Move USDG from your trading account back to your wallet.</small>
                </button>
                <button className="luna-btn" onClick={() => setModal({ type: "session" })}>
                  <span>
                    Session & limits <ArrowUpRight size={12} />
                  </span>
                  <small>Manage the browser session key and local preferences.</small>
                </button>
              </div>
            ) : (
              <button
                className="luna-btn luna-btn-active pm-wide"
                onClick={() => setModal({ type: "wallet" })}
              >
                Connect wallet
              </button>
            )}
          </>
        )}
        {value.type === "settings" && walletConnected && <div className="dream-reset">
          <button className="luna-btn" onClick={()=>{setWalletConnected(false);notify("Wallet disconnected from this interface.");close();}}>Disconnect wallet</button>
        </div>}
        {value.type === "wallet" && (
          <div className="pm-wallet-list">
            {wallets.length ? <>
              {wallets.map(({ info, provider }) => {
                const name = info.name || "Browser Wallet";
                return (
                  <button key={info.uuid || info.rdns || name} type="button" onClick={() => connectWallet(provider, name)} disabled={busy} aria-busy={connecting === name}>
                    {info.icon ? <img src={info.icon} alt="" /> : <span className="pm-wallet-fallback"><Wallet size={16}/></span>}
                    <strong>{name}</strong>
                    {connecting === name
                      ? <small><Loader2 size={13} className="pm-wallet-spin" /> Confirm in wallet</small>
                      : <ChevronRight size={16} className="pm-wallet-go" />}
                  </button>
                );
              })}
              <p className="pm-wallet-note">JackTrade never sees your keys. Trades are signed in your wallet, on Robinhood Chain.</p>
            </> : walletsScanned ? <div className="pm-wallet-empty"><Wallet size={25}/><strong>No browser wallet found</strong><small>Install an EVM wallet such as Rabby or MetaMask, then reload this page.</small></div> : null}
          </div>
        )}
        {value.type === "deposit-trade" && (
          <div className="pm-deposit-source">
            {!depositOpen ? <>
              <button type="button" className="pm-deposit-chain" onClick={() => { setAmount(String(minDeposit)); setDepositOpen(true); }}>
                <img className="pm-chain-logo" src="/logos/robinhood-chain.svg" alt="" />
                <span><strong>From Robinhood Chain</strong><small>{money(account.walletBalance)} USDG in your wallet</small></span>
                <span />
                <ChevronRight size={16} className="pm-deposit-go"/>
              </button>
              <button
                type="button"
                className="pm-deposit-chain"
                disabled={!CROSS_CHAIN_DEPOSITS || !walletConnected}
                onClick={() => setModal({ type: "bridge" })}
              >
                <img className="pm-chain-logo" src="/logos/trustware.png" alt="" />
                <span><strong>From any chain or asset</strong><small>{CROSS_CHAIN_DEPOSITS ? "Any token, any chain · via Trustware" : "Via Trustware · coming soon"}</small></span>
                <span />
                <ChevronRight size={16} className="pm-deposit-go"/>
              </button>
            </> : <>
              <button type="button" className="pm-deposit-back" onClick={() => setDepositOpen(false)}><ChevronLeft size={14} /> Deposit options</button>
              <AmountField value={amount} onChange={setAmount} balance={account.walletBalance} balanceLabel="in your wallet on Robinhood Chain" />
              <button className="pm-sheet-primary" onClick={transfer} disabled={busy || !(Number(amount) >= minDeposit) || Number(amount) > account.walletBalance}>
                {busy ? "Confirm in your wallet…" : Number(amount) > account.walletBalance ? "Not enough USDG in your wallet" : Number(amount) < minDeposit ? `Minimum deposit is ${money(minDeposit, 0)} USDG` : `Deposit ${money(Number(amount))} USDG`}
              </button>
              <p className="pm-sheet-note">
                {activationFee > 0
                  ? `First deposit: minimum ${money(minDeposit, 0)} USDG, including a one-time ${money(activationFee, 0)} USDG activation fee. One signature, no gas.`
                  : "One signature, no gas: JackTrade pays it."}
              </p>
            </>}
          </div>
        )}
        {value.type === "close" && <ClosePosition id={value.id} close={close} />}
        {value.type === "funds" && (
          <div className="pm-deposit-source">
            <AmountField value={amount} onChange={setAmount} balance={account.availableMargin} balanceLabel="available on the Exchange" />
            <button className="pm-sheet-primary" onClick={transfer} disabled={busy || !(Number(amount) > 0) || Number(amount) > account.availableMargin}>
              {busy ? "Confirm in your wallet…" : Number(amount) > account.availableMargin ? "More than you have available" : `Withdraw ${money(Number(amount) || 0)} USDG`}
            </button>
            <p className="pm-sheet-note">Arrives as USDG in your wallet on Robinhood Chain. Open positions keep their margin.</p>
          </div>
        )}
        {value.type === "session" && (
          <>
            <div className="pm-callout">
              {account.sessionUntil > Date.now()
                ? `Trading session ends ${new Date(account.sessionUntil).toLocaleDateString()}`
                : "No active session"}
            </div>
            <p>A session key lets this browser sign orders without reopening your wallet. It cannot withdraw your funds.</p>
            <button className="luna-btn" onClick={async()=>{setError("");setBusy(true);try{await account.enableSession();notify("Trading session enabled for this device.");}catch(reason){setError(reason.message);}finally{setBusy(false);}}} disabled={busy}>
              Enable / renew trading session
            </button>
            <div className="pm-modal-actions">
              <button
                className="luna-btn"
                onClick={() => {
                  account.update((s) => ({ ...s, pauseUntil: Date.now() + 86400000 }));
                  notify("Trading paused for 24 hours on this device. Existing positions remain open.");
                  close();
                }}
              >
                Pause trading for 24h on this device
              </button>
              <button
                className="luna-btn"
                onClick={async () => {
                  const result = await account.revokeSession();
                  if (!result.ok) setError(result.error);
                  else { notify("Trading session revoked on-chain."); close(); }
                }}
              >
                Revoke session
              </button>
            </div>
            <small className="pm-muted">
              Interface preferences stay on this device. Protocol permissions remain verifiable on-chain.
            </small>
          </>
        )}
        {value.type === "username" && (
          walletConnected && walletAddress ? (
            <>
              <p>
                {profile?.username ? "Your public profile" : "Your public profile will be"}: /u/{username || "your.name"}
              </p>
              <label className="pm-field">
                Username
                <input
                  value={username}
                  maxLength="24"
                  aria-invalid={nameStatus?.tone === "bad" || !!error}
                  aria-describedby="pm-username-status"
                  disabled={busy || !profile}
                  onChange={(e) => {
                    setUsername(e.target.value.toLowerCase());
                    setError("");
                  }}
                />
              </label>
              <p id="pm-username-status" className={`pm-field-status ${error ? "is-bad" : nameStatus ? `is-${nameStatus.tone}` : ""}`} role="status">
                {error || nameStatus?.text || "\u00a0"}
              </p>
              <button className="luna-btn luna-btn-active pm-wide" onClick={saveUsername} disabled={busy || !profile || nameStatus?.tone === "bad"}>
                {busy ? "Waiting for wallet signature…" : !profile ? "Loading profile…" : profile.username ? "Change username" : "Claim username"}
              </button>
              <small className="pm-muted">
                Usernames are unique and public. Your wallet signs a one-time message (no transaction, no gas). After the first one, you can change it once every 24 hours.
              </small>
            </>
          ) : (
            <>
              <p>Connect your wallet to claim a username. It is linked to your wallet and shown on the leaderboard.</p>
              <button className="luna-btn luna-btn-active pm-wide" onClick={() => setModal({ type: "wallet" })}>
                Connect wallet
              </button>
            </>
          )
        )}
        {value.type === "share" && (
          <>
            <div className="pm-share-card">
              <span>jacktrade</span>
              <p>{shareTitle}</p>
              <strong className={share.tone ? `pm-${share.tone}` : undefined}>{shareValue}</strong>
              <small>{shareDetail}</small>
              <em>ON-CHAIN DATA / ROBINHOOD CHAIN</em>
            </div>
            <div className="pm-modal-actions">
              <button className="luna-btn" onClick={copy}>
                <Copy size={13} /> Copy text
              </button>
              <button className="luna-btn luna-btn-active" onClick={download}>
                <Download size={13} /> Download card
              </button>
            </div>
          </>
        )}
        {error && value.type !== "username" && (
          <p role="alert" className="pm-error">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
