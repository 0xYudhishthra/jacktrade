import { useEffect, useState } from "react";
import { getPoints, getPointsLeaderboard } from "../lib/api.js";
import { short } from "../lib/chain.js";
import { useWallet } from "../components/Wallet.jsx";
import { ErrorBox } from "../components/Common.jsx";

const fmt = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

export default function PointsPage() {
  const { account } = useWallet();
  const [mine, setMine] = useState(null);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    getPointsLeaderboard().then(setRows).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    if (!account) return setMine(null);
    getPoints(account).then(setMine).catch(() => setMine(null));
  }, [account]);

  return (
    <div className="page">
      <section className="card">
        <h1>JackTrade Points</h1>
        <p className="muted">
          Every bet earns <b>10 points per $100 of notional</b> (margin × leverage), win or lose. Points are
          computed from onchain trade history, so anyone can verify them.
        </p>
        {mine && (
          <div className="bet-grid">
            <div>
              <span className="stat-label">Your points</span>
              <span className="stat-value">{fmt(mine.points)}</span>
            </div>
            <div>
              <span className="stat-label">Notional traded</span>
              <span className="stat-value">${fmt(mine.notionalUsd)}</span>
            </div>
            <div>
              <span className="stat-label">Trades</span>
              <span className="stat-value">{mine.trades}</span>
            </div>
          </div>
        )}
      </section>
      <section className="card">
        <h2>Leaderboard</h2>
        <ErrorBox error={err} />
        {rows.length === 0 && !err && <p className="muted">No trades yet.</p>}
        {rows.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Trader</th>
                <th>Notional</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.wallet}>
                  <td>{r.rank}</td>
                  <td className="mono">{r.username || short(r.wallet)}</td>
                  <td>${fmt(r.notionalUsd)}</td>
                  <td>
                    <b>{fmt(r.points)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
