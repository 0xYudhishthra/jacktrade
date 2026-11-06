// Hackathon addition (ETHGlobal Mumbai 2026): JackTrade Points, which replace the lose-to-earn token.
// 10 points per $100 of notional (margin × leverage), win or lose, computed by the connector from onchain history.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Shell, Panel, Metric } from "@/components/product/ProductUI";
import { useTradingSession } from "@/hooks/useTradingSession";
import { getPoints, getPointsLeaderboard } from "@/lib/grok/api";
import { ErrorBox, short } from "@/components/grok/GrokUI";

const fmt = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

export default function PointsPage() {
  const { walletAddress, walletConnected } = useTradingSession();
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
    <Shell
      title="JackTrade Points"
      kicker="JACKTRADE / POINTS"
      subtitle="Every bet earns 10 points per $100 of notional (margin × leverage), win or lose. Points come from onchain trade history, so anyone can recompute them."
    >
      <div className="jt-grok">
        <Panel title="Your points">
          {account && mine ? (
            <div className="jt-metrics">
              <Metric label="Points" value={fmt(mine.points)} />
              <Metric label="Notional traded" value={`$${fmt(mine.notionalUsd)}`} />
              <Metric label="Trades" value={fmt(mine.trades)} />
            </div>
          ) : account ? (
            <p className="jt-muted">Loading your points…</p>
          ) : (
            <p className="jt-muted">Connect your wallet to see your points.</p>
          )}
          <p className="jt-small jt-muted">
            A $20 bet at 50× is $1,000 of notional and earns 100 points. Bets Grok places for you count too:{" "}
            <Link to="/grok">connect Grok</Link>.
          </p>
        </Panel>
        <Panel title="Leaderboard">
          <ErrorBox error={err} />
          {rows === null ? (
            <div className="pm-empty">Loading leaderboard…</div>
          ) : rows.length === 0 ? (
            !err && <div className="pm-empty">No trades yet.</div>
          ) : (
            <div className="pm-table-scroll">
              <table className="pm-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Trader</th>
                    <th>Notional</th>
                    <th>Trades</th>
                    <th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.wallet}>
                      <td>{r.rank ?? i + 1}</td>
                      <td className="jt-mono">
                        {r.username || short(r.wallet)}
                        {r.wallet?.toLowerCase() === me && <small> YOU</small>}
                      </td>
                      <td>${fmt(r.notionalUsd)}</td>
                      <td>{r.trades ?? "–"}</td>
                      <td>
                        <strong>{fmt(r.points)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
