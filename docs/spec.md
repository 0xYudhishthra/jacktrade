# JackTrade: spec

Status: built, ETHGlobal Mumbai 2026 (deadline Sat 7 Nov, 09:00 IST). This describes what ships; the
README has the overview.

## Problem

People already use Grok to read the news and X and form a view ("tariffs are bad for
TSLA this week"). Then they leave Grok to go trade. We put the trade inside Grok.

## Product

JackTrade is a bet-against-the-house exchange: you go long or short with leverage,
the house takes the other side. People trade it from the web app; this project makes
AI agents first-class traders too:

1. **Grok connector.** A remote MCP server a user adds once at grok.com/connectors (or in
   any MCP client). The agent gets tools to check the house, quote, trade, arm
   conditional trades that fire when a price crosses a level, track trades, cash out and
   read points.
2. **Web app.** The JackTrade trading app (terminal, portfolio, house, leaderboard),
   redesigned, plus Connect Grok (wallet → approve the agent's key → set limits → copy
   the MCP link), a public feed of agent trades, and **Make it real**: copy an agent's
   trade into the real stock token with a Definitive Flash advanced order.
3. **JackTrade Points.** 10 points per $100 of position size, win or lose, computed from
   onchain history, plus `JackTradePoints`, a non-transferable onchain ledger for them.

## Safety model

- Grok trades with a **session key** registered on JackTrade's SessionKeyManager.
  Session keys can open and close positions but **can never withdraw**.
- Session keys have no onchain size/leverage limits, so the connector enforces per-user
  caps: max margin per bet, max leverage, daily loss limit. Conditional trades are checked
  when armed and again when they fire.
- The user can revoke the key at any time from their wallet.
- Agent keys are generated server-side and stored encrypted (AES-256-GCM).
- The MCP URL contains a long random secret (bearer-in-path). Hackathon trade-off;
  OAuth is the follow-up.

## Components and interfaces

### connector/ (Node 22+, TypeScript)

Upstream (read at runtime, nothing hardcoded except base URLs):
- `GET {RELAYER}/config`: addresses, EIP-712 domain/types, markets, chainTime.
- `POST {RELAYER}/intent` `{kind:"open"|"close", intent, signature}` → `{id, status}`.
- `GET {RELAYER}/intent/:id` → `queued | submitted | executed{positionId, price, txHash} | failed{code, message}`.
- `GET {RELAYER}/health` → `lpBankrollAvailable`, `totalQueued`, `chainTime`.
- `GET {PRICES}/prices` → `[{market, name, price, expo, usd, publishTime, marketOpen?}]`.
- `GET {INDEXER}/api/positions/:user`, `/api/account/:user`, `/api/house`, `/api/stats`.

Signing rules (from the live relayer):
- `Open{user, instrumentId, isLong, margin, leverage, priceLimit, signedAt, nonce}`.
  `margin` is USDG with 6 decimals, `leverage` is a plain integer, `priceLimit` is WAD
  (max entry for longs, min entry for shorts), `signedAt` is chain time (within 30 s),
  `nonce` is a random uint256. `user` is the wallet, signed by the session key.
- `Close{user, positionId, priceLimit, signedAt, nonce}`; `priceLimit` is min exit for
  longs, max exit for shorts.
- Market minimums from `/config`: `minMargin` 10 USDG, `minNotional` 20 USDG.

MCP endpoint: `POST|GET|DELETE /mcp/:token` (Streamable HTTP, stateless).

MCP tools:

| Tool | Input | Output |
| --- | --- | --- |
| `list_markets` | none | markets with live price, max leverage, open/closed |
| `house_status` | none | bankroll, payout queue, open interest |
| `quote_bet` | `market, side, margin_usd, leverage` | entry, notional, liquidation price, cap check, house warning |
| `place_bet` | `market, side, margin_usd, leverage, max_slippage_pct?` | position id, fill price, tx link |
| `my_bets` | none | open positions with PnL and liquidation price |
| `cash_out` | `position_id` | exit price, tx link |
| `set_trigger` | `market, side, margin_usd, leverage, condition (above or below), price, expires_in_hours?` | trigger id; fires a bet when the price crosses (default expiry 24 h) |
| `list_triggers` | none | armed and recently fired conditional bets |
| `cancel_trigger` | `trigger_id` | disarms it |
| `my_points` | none | the user's points and the top of the leaderboard |
| `make_it_real` | `position_id?, market?` | link to the web app to buy the real token via Flash |

REST for the web app:
- `POST /api/connect/start` `{wallet}` → `{pendingId, agentAddress, expiry}`
- `POST /api/connect/finish` `{pendingId, caps:{maxMarginUsd, maxLeverage, dailyLossUsd}}`
  → verifies `isValidSessionKey(wallet, agentAddress)` onchain → `{mcpUrl}`
- `GET /api/bets?limit=`, `GET /api/bets/:id` → public feed of bets placed through the connector
- `GET /api/triggers?limit=` → recent conditional bets
- `GET /api/points`, `GET /api/points/:wallet` → points leaderboard and one wallet's points
- `POST /api/flash/quote`, `POST /api/flash/order`, `GET /api/flash/orders?wallet=`:
  thin proxies to Flash that keep the API key server-side.
- `GET /health`

Storage: SQLite (`node:sqlite`), tables `users`, `pending`, `bets` and `triggers`.

Trigger watcher: every 3 s it reads Pyth prices from the prices service and fires any armed
trigger whose level was crossed, through the same signing path and cap checks as
`place_bet`.

### web/ (React 19, TanStack Router, Vite 8, viem)

The pre-existing JackTrade trading app, redesigned (dark only, Jack as the logo), with:

- `/grok` Connect Grok: connect wallet, check the JackTrade balance, sign
  `RegisterSessionKey` for the agent key (relayed gasless via `POST {RELAYER}/action`),
  set caps, copy the MCP URL with Grok setup steps, revoke the key.
- `/bets` Agent bets feed with live PnL.
- `/real/:id` Make it real: Flash quote → approve/sign → order → status, with a
  bracket (take-profit / stop-loss) derived from the bet. Long bet → market buy with
  attached bracket. Short bet → limit buy at the short's target.
- `/points` JackTrade Points leaderboard.
- Usernames: claimed with a wallet signature against the indexer's `/api/profile` API,
  shown on the leaderboard and profiles.

### contracts/ (Foundry)

`JackTradePoints`: ERC-20-shaped but non-transferable. A syncer pushes each trader's
cumulative notional with `sync(users, cumulativeNotional)` and the contract mints the
difference (10 points per $100), so re-syncing is idempotent. See `contracts/README.md`.

## Demo (≤ 4 min)

1. Hook in Grok. 2. Connect Grok (sped up). 3. Grok analysis → `house_status` →
`quote_bet` → `place_bet` → tx on Robinhood Chain. 4. A conditional trade with
`set_trigger`. 5. Trades show in the feed. 6. A follower clicks Make it real → Flash order
lands onchain. 7. Close. See `docs/demo-runbook.md`.

## Out of scope

ENS, CCIP, Chainlink CRE (dropped to focus on Definitive Flash), Grok placing Flash orders
from a server-held wallet, OAuth for the connector.
