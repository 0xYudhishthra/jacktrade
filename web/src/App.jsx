import { NavLink, Route, Routes, Link } from "react-router-dom";
import { WalletProvider, WalletButton } from "./components/Wallet.jsx";
import ConnectPage from "./pages/Connect.jsx";
import BetsPage from "./pages/Bets.jsx";
import RealPage from "./pages/Real.jsx";
import PointsPage from "./pages/Points.jsx";

export default function App() {
  return (
    <WalletProvider>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark">J</span>
            <span className="brand-name">
              JackTrade <span className="muted">for Grok</span>
            </span>
          </Link>
          <nav className="nav">
            <NavLink to="/" end>
              Connect
            </NavLink>
            <NavLink to="/bets">Grok bets</NavLink>
            <NavLink to="/points">Points</NavLink>
          </nav>
          <WalletButton />
        </div>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<ConnectPage />} />
          <Route path="/bets" element={<BetsPage />} />
          <Route path="/points" element={<PointsPage />} />
          <Route path="/real/:id" element={<RealPage />} />
          <Route
            path="*"
            element={
              <div className="card">
                <h2>Page not found</h2>
                <p>
                  <Link to="/">Go to Connect Grok</Link>
                </p>
              </div>
            }
          />
        </Routes>
      </main>
      <footer className="footer">
        <span>Read the news in Grok. Bet on it in the same chat.</span>
        <span className="muted">Robinhood Chain · 4663</span>
      </footer>
    </WalletProvider>
  );
}
