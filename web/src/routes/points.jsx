// Hackathon addition (ETHGlobal Mumbai 2026): JackTrade Points, which replace the lose-to-earn token.
// 10 points per $100 of notional (margin × leverage), win or lose, computed by the connector from onchain history.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Shell } from "@/components/product/ProductUI";
import { useTradingSession } from "@/hooks/useTradingSession";
import { useProductUI } from "@/components/product/ProductUI";
import { getPoints, getPointsLeaderboard } from "@/lib/grok/api";
import { ErrorBox, PageHead, short } from "@/components/grok/GrokUI";

const fmt = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

export default function PointsPage() {
  const { walletAddress, walletConnected } = useTradingSession();
  const { setModal } = useProductUI();
  const account = walletConnected ? walletAddress : null;
  const me = account?.toLowerCase();
  const [mine, setMine] = useState(null);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    getPointsLeaderboard()
      .then((list) => live && setRows(list))
      .catch((e) => {
        if (!live) return;
        setErr(e.message);
        setRows([]);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!account) return;
    let live = true;
    getPoints(account)
      .then((p) => live && setMine(p))
      .catch(() => live && setMine(null));
    return () => {
      live = false;
    };
  }, [account]);

  return (
    <Shell>
      <div className="jt-page">
        <PageHead title="Points">Every trade earns 10 points per $100 of position size, win or lose.</PageHead>

        {account ? (
          <div className="jt-stats">
            <div className="jt-stat is-lead">
              <span>Your points</span>
              <strong>{mine ? fmt(mine.points) : "…"}</strong>
            </div>
            <div className="jt-stat">
              <span>Volume traded</span>
              <strong>{mine ? `$${fmt(mine.notionalUsd)}` : "…"}</strong>
            </div>
            <div className="jt-stat">
              <span>Trades</span>
              <strong>{mine ? fmt(mine.trades) : "…"}</strong>
            </div>
          </div>
        ) : (
          <div className="jt-card-plain jt-points-cta">
            <img src="/brand/jack-256.webp" alt="" width="48" height="48" />
            <div>
              <h3>See your points</h3>
              <p>Connect your wallet to see where you stand.</p>
            </div>
            <button className="jt-btn" type="button" onClick={() => setModal({ type: "wallet" })}>
              Connect wallet
            </button>
          </div>
        )}

        <div className="jt-split jt-points-split">
          <section className="jt-table-wrap" aria-labelledby="jt-points-board">
            <div className="jt-table-head">
              <h2 id="jt-points-board">Leaderboard</h2>
            </div>
            <ErrorBox error={err} />
            {rows === null ? (
              <div className="jt-empty">Loading…</div>
            ) : rows.length === 0 ? (
              !err && (
                <div className="jt-empty">
                  <img src="/brand/jack-256.webp" alt="" />
                  <strong>No trades yet</strong>
                  <span>The first trade puts you at the top.</span>
                </div>
              )
            ) : (
              <table className="jt-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Trader</th>
                    <th className="is-num">Volume</th>
                    <th className="is-num">Trades</th>
                    <th className="is-num">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const rank = r.rank ?? i + 1;
                    const isMe = r.wallet?.toLowerCase() === me;
                    return (
                      <tr key={r.wallet} className={isMe ? "is-me" : undefined}>
                        <td>
                          <span className={`jt-rank ${rank <= 3 ? "is-top" : ""}`}>{rank}</span>
                        </td>
                        <td>
                          {r.username ? `@${r.username}` : <span className="jt-mono">{short(r.wallet)}</span>}
                          {isMe && <span className="jt-you">You</span>}
                        </td>
                        <td className="is-num">${fmt(r.notionalUsd)}</td>
                        <td className="is-num">{r.trades ?? "–"}</td>
                        <td className="is-num jt-strong">{fmt(r.points)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <aside className="jt-aside">
            <div className="jt-card-plain">
              <h3>How points work</h3>
              <p>Position size is margin × leverage. Every $100 of it earns 10 points, whether the trade wins or loses.</p>
              <div className="jt-example">
                <span>$20 at 50×</span>
                <span>$1,000 position</span>
                <strong>100 points</strong>
              </div>
              <p>
                Points come straight from onchain trade history, so anyone can recompute them. Trades your AI agent places
                count too: <Link to="/grok">connect Grok</Link>.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </Shell>
  );
}
