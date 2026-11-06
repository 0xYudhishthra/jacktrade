import { useState } from "react";
import { short, txUrl } from "../lib/chain.js";

export function TxHash({ hash, label }) {
  if (!hash) return null;
  const url = txUrl(hash);
  const text = label || short(hash, 6);
  if (url) {
    return (
      <a className="mono" href={url} target="_blank" rel="noreferrer" title={hash}>
        {text} ↗
      </a>
    );
  }
  return (
    <span className="mono selectable" title={hash}>
      {hash}
    </span>
  );
}

export function CopyButton({ text, label = "Copy", className = "btn btn-sm" }) {
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
  return <div className="alert alert-error">{error}</div>;
}

export function Step({ n, title, state, children }) {
  // state: "todo" | "active" | "done" | "error"
  return (
    <section className={`step step-${state}`}>
      <div className="step-head">
        <span className="step-n">{state === "done" ? "✓" : n}</span>
        <h3>{title}</h3>
      </div>
      {state !== "todo" && <div className="step-body">{children}</div>}
    </section>
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
  const digits = n >= 1000 ? 2 : n >= 1 ? 2 : 6;
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
