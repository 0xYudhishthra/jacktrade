import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import Trade from '@/routes/trade';
import '@/landing.css';

export default function LandingPage() {
  const preview = useRef(null);
  const [scale, setScale] = useState(.6);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1440));
    observer.observe(preview.current);
    return () => observer.disconnect();
  }, []);

  return (
    <main className="jt-landing">
      <nav className="jt-nav" aria-label="Main navigation">
        <Link to="/" className="jt-brand" aria-label="JackTrade home">
          <img src="/brand/jack-256.webp" alt="" width="30" height="30" />
          JackTrade
        </Link>
        <div className="jt-nav-links">
          <Link to="/grok">Agents</Link>
          <Link to="/help">Docs</Link>
          <Link to="/trade" className="jt-nav-app">Open app</Link>
        </div>
      </nav>

      <section className="jt-hero">
        <img className="jt-hero-mark" src="/brand/jack-512.webp" alt="Jack, the JackTrade mascot" width="512" height="512" />
        <h1>Markets,<br />on&nbsp;command.</h1>
        <p className="jt-lede">
          Go long or short on US stocks and crypto, with up to 1000× leverage. Place the trade yourself, or tell your
          AI agent to. Same market, same rules.
        </p>
        <div className="jt-hero-actions">
          <Link to="/trade" className="jt-button">Start trading</Link>
          <Link to="/grok" className="jt-link">Connect an agent →</Link>
        </div>
      </section>

      <figure className="jt-shot">
        <div className="jt-shot-frame">
          <div className="dream-preview-screen jt-shot-screen" ref={preview}>
            <div className="dream-preview-content" inert aria-hidden="true" style={{ transform: `scale(${scale})` }}><Trade preview /></div>
          </div>
          <Link to="/trade" className="dream-preview-link" aria-label="Open the trading terminal" />
        </div>
      </figure>

      <section className="jt-notes" aria-label="How it works">
        <div>
          <h2>No order book</h2>
          <p>The house takes the other side at the oracle price. Wins are paid from its bankroll, in order.</p>
        </div>
        <div>
          <h2>Built for agents</h2>
          <p>Plug JackTrade into Grok, Claude or any MCP client. Your agent can quote, open and close trades, and never withdraw.</p>
        </div>
        <div>
          <h2>Your limits</h2>
          <p>Cap an agent's trade size, leverage and daily loss. Revoke its key from your wallet any time.</p>
        </div>
      </section>

      <footer className="jt-foot">
        <span>JackTrade</span>
        <span>Robinhood Chain</span>
      </footer>
    </main>
  );
}
