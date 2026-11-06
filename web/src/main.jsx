import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  Link,
} from "@tanstack/react-router";
import LandingPage from "./components/jacktrade/LandingPage";
import TradePage from "./routes/trade";
import PortfolioPage from "./routes/profile";
import LeaderboardPage from "./routes/ranking";
import HousePage from "./routes/house";
import TokenPage from "./routes/token";
import HelpPage from "./routes/help";
import { ProductUIProvider, Shell, Panel } from "./components/product/ProductUI";
import { TradingSessionProvider } from "./context/TradingSession";
import { ThemeProvider } from "./components/dream/ThemeProvider";
import "./index.css";

// Landing and terminal share a client-side router.
const root = createRootRoute({
  component: () => (
    <ThemeProvider><TradingSessionProvider>
      <ProductUIProvider>
        <Outlet />
      </ProductUIProvider>
    </TradingSessionProvider></ThemeProvider>
  ),
});
const routes = root.addChildren([
  createRoute({ getParentRoute: () => root, path: "/house", component: HousePage }),
  createRoute({ getParentRoute: () => root, path: "/token", component: TokenPage }),
  createRoute({ getParentRoute: () => root, path: "/help", component: HelpPage }),
  createRoute({ getParentRoute: () => root, path: "/docs", component: HelpPage }),
  createRoute({ getParentRoute: () => root, path: "/u/$username", component: PortfolioPage }),
  createRoute({ getParentRoute: () => root, path: "/", component: LandingPage }),
  createRoute({ getParentRoute: () => root, path: "/trade", component: TradePage }),
  createRoute({ getParentRoute: () => root, path: "/portfolio", component: PortfolioPage }),
  createRoute({ getParentRoute: () => root, path: "/leaderboard", component: LeaderboardPage }),
]);
// Unknown paths stay inside the app: header, theme and a way back to trading.
const NotFound = () => (
  <Shell dashboard="not-found">
    <Panel title="Page not found" className="pm-not-found">
      <p>There's nothing at this address.</p>
      <Link to="/trade" className="luna-btn luna-btn-active">Back to trading</Link>
    </Panel>
  </Shell>
);
const router = createRouter({ routeTree: routes, scrollRestoration: true, defaultNotFoundComponent: NotFound });
createRoot(document.getElementById("root")).render(<RouterProvider router={router} />);

import "./sky-controls.css";

import "./explore.css";

import "./focus.css";

import "./nocturne.css";

import "./eastern-violet.css";

import "./product.css";

import "./original-ui.css";

import "./dashboard.css";

import "./desk-layout.css";

import "./wordmark-motion.css";

import "./desk-dashboards.css";

import "./live-trading.css";

import "./dream.css";
import "./dream-theme.css";
import "./docs.css";
