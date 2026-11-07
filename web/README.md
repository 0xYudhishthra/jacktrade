# JackTrade · web app

The JackTrade trading app: a terminal to go long or short with leverage on Robinhood Chain, plus the pages that let AI agents trade for you. Dark only, with Jack as the logo.

React 19, TanStack Router, Vite 8, Tailwind CSS 3, viem and wagmi (Reown AppKit when configured). Needs Node 22.12+ and Bun.

## Run it

```sh
bun install --frozen-lockfile
bun run dev        # http://127.0.0.1:8018 (strict port)
bun run check      # lint, tests and production build
```

In development the app talks to the connector at `http://localhost:8787` (see [`../connector`](../connector)); in production the connector serves this app from the same origin. The exchange services (prices, relayer, indexer) default to production.

## Pages

| Route | Page | Source |
|-------|------|--------|
| `/` | Landing | `src/components/jacktrade/LandingPage.jsx` |
| `/trade` | Terminal: live chart, order ticket, positions | `src/routes/trade.jsx` |
| `/grok` | Connect Grok: wallet → approve Grok's key (gasless) → limits → private MCP link; revoke | `src/routes/grok.jsx` |
| `/bets` | Agent bets: live feed of trades placed by agents | `src/routes/bets.jsx` |
| `/real/:id` | Make it real: copy an agent's trade with a Definitive Flash order | `src/routes/real.jsx` |
| `/portfolio`, `/u/:username` | Your portfolio, public profiles | `src/routes/profile.jsx` |
| `/house` | The house: bankroll, payout queue, exposure, liquidation heatmap | `src/routes/house.jsx` |
| `/points` | JackTrade Points and their leaderboard | `src/routes/points.jsx` |
| `/leaderboard` | Trader leaderboard | `src/routes/ranking.jsx` |
| `/docs` | Help and FAQ | `src/routes/help.jsx` |

Dialogs (wallet, deposit, withdraw, settings, session, username, share card, close position) live in `src/components/product/ProductUI.jsx`.

## Environment

Copy `.env.example` to `.env.local` only to override the defaults. `VITE_*` values are baked in at build time.

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_CONNECTOR_URL` | `http://localhost:8787` in dev, same origin in production | Grok connector: connect flow, agent bets, points, Flash proxy |
| `VITE_PRICES_URL` | production prices service | Live Pyth prices (websocket) and history |
| `VITE_RELAYER_URL` | production relayer | `/config`, orders and signed actions |
| `VITE_API_URL` | production indexer | Accounts, positions, history, house, leaderboard, profiles |
| `VITE_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` | Robinhood Chain RPC |
| `VITE_EXPLORER_URL` | empty | Block explorer for tx and address links; empty shows hashes as text |
| `VITE_REOWN_PROJECT_ID` | empty | Reown AppKit wallet picker; without it, the built-in list of browser wallets |
| `VITE_TRUSTWARE_API_KEY` | empty | Deposits from any chain via Trustware; without it, that option is hidden |

## How it trades

Wallet actions use Robinhood Chain (chain id 4663). Orders are signed with a session key generated in the browser and sent through the relayer, so trading needs no wallet prompt per order; deposits, withdrawals and usernames are signed in the wallet. The session key can trade but never withdraw. The app refuses to run inside another site's frame.

The order ticket needs at least 10 USDG of margin. Leverage goes from 10× to the market's maximum in 10× steps, and stricter limits from the relayer's `/config` always apply.

Usernames are saved to the indexer with a one-time wallet signature (no gas). Set one from the wallet chip in the header, Settings, or your Portfolio.

## Design

- Theme: `src/theme.css` (palette, terminal, dialogs, menus) and `src/pages.css` (agent pages and dashboards), loaded last over the older styles. Ivory on near-black; colour only for long/short and PnL.
- Landing: `src/landing.css`.
- Brand assets: `public/brand/` (Jack at 256 and 512 px, favicon, Apple touch icon).
- Jack talks in the tab title while you're away (`src/hooks/useTabTitle.js`) and under the leverage slider (`src/components/product/Ticket.jsx`).

## Deploy

The root [`Dockerfile`](../Dockerfile) builds this app and serves it from the connector, so one service runs both. `vercel.json` still has SPA rewrites if you deploy the app on its own; set `VITE_CONNECTOR_URL` to the connector's URL in that case.
