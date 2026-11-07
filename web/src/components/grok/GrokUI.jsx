// Hackathon addition (ETHGlobal Mumbai 2026): small shared pieces for the Grok pages, styled with the exchange UI.
import { useState } from "react";
import { EXPLORER_URL } from "@/lib/grok/config";

export function short(addr, n = 4) {
  if (!addr) return "";
  const s = String(addr);
  return s.length <= 2 + n * 2 ? s : `${s.slice(0, 2 + n)}…${s.slice(-n)}`;
}

export function txUrl(hash) {
  return EXPLORER_URL && hash ? `${EXPLORER_URL}/tx/${hash}` : null;
}

export function TxHash({ hash, label }) {
  if (!hash) return null;
  const url = txUrl(hash);
  const text = label || short(hash, 6);
  if (url) {
    return (
      <a className="jt-mono" href={url} target="_blank" rel="noreferrer" title={hash}>
        {text} ↗
      </a>
    );
  }
  return (
    <span className="jt-mono jt-selectable" title={hash}>
      {hash}
    </span>
  );
}

export function CopyButton({ text, label = "Copy", className = "luna-btn" }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button className={className} onClick={copy} type="button">
      {done ? "Copied" : label}
    </button>
  );
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <div className="jt-alert jt-alert-error" role="alert">
      {error}
    </div>
  );
}

export function Note({ children, tone = "warn" }) {
  return <div className={`jt-alert jt-alert-${tone}`}>{children}</div>;
}

export function Step({ n, title, hint, state, children }) {
  // state: "todo" | "active" | "done" | "error"
  return (
    <li className={`jt-step is-${state}`}>
      <span className="jt-step-n" aria-hidden="true">{state === "done" ? "✓" : n}</span>
      <div className="jt-step-main">
        <h2>{title}</h2>
        {state === "todo" && hint && <p className="jt-step-hint">{hint}</p>}
        {state !== "todo" && <div className="jt-step-body">{children}</div>}
      </div>
    </li>
  );
}

/** Page intro for the agent pages: title and one line, aligned with the content below. */
export function PageHead({ title, children, aside }) {
  return (
    <header className="jt-page-head">
      <div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {aside}
    </header>
  );
}

/** "via Grok" tag for positions and trades placed by Grok through the JackTrade connector. */
export function GrokBadge({ className = "" }) {
  return (
    <span className={`jt-grok-badge ${className}`} title="Placed by Grok through the JackTrade connector">
      via Grok
    </span>
  );
}

export function fmtUsd(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "–";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "–";
  const digits = n >= 1 ? 2 : 6;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function timeAgo(ts) {
  if (!ts) return "";
  let ms = typeof ts === "number" ? ts : Date.parse(ts);
  if (typeof ts === "number" && ts < 1e12) ms = ts * 1000;
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Key/value grid (label, value pairs). */
export function KV({ rows }) {
  return (
    <dl className="jt-kv">
      {rows.filter(Boolean).map(([k, v, tone]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className={tone || undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
