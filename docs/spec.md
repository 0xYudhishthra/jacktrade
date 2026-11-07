# JackTrade: spec

Status: approved direction, ETHGlobal Mumbai 2026 (deadline Sat 7 Nov, 09:00 IST).

## Problem

People already use Grok to read the news and X and form a view ("tariffs are bad for
TSLA this week"). Then they leave Grok to go trade. We put the trade inside Grok.

## Product

JackTrade is a bet-against-the-house exchange: you go long or short with leverage,
the house takes the other side. This project adds an agent rail on top of it:

1. **Grok connector.** A remote MCP server a user adds once at grok.com/connectors.
   Grok gets tools to check the house, quote a bet, place it, list bets and cash out.
2. **Web app.** Connect Grok (wallet → approve Grok's trading key → set limits → copy
   connector URL), a public feed of bets placed by Grok, and **Make it real**: copy a
   Grok bet into the real stock token with a Definitive Flash advanced order.
3. **Conditional bets.** Grok can arm a bet that fires when a price crosses a level
   ("short TSLA 20x with $20 if it drops below $350"), so it acts while the user is away.
4. **JackTrade Points.** 10 points per $100 of notional, win or lose, recorded onchain by
   the JackTradePoints contract. Losses no longer mint a lose-to-earn token.
5. **Fresh deployment.** The exchange is redeployed on Robinhood Chain with the new points
   logic and JackTrade signing domains, with its own backend (prices, relayer, Ponder
   indexer) on Railway.

## Safety model

- Grok trades with a **session key** registered on JackTrade's SessionKeyManager.
  Session keys can open and close positions but **can never withdraw**.
- Session keys have no onchain size/leverage limits, so the connector enforces per-user
  caps: max margin per bet, max leverage, daily loss limit.
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
- Market minimums come from `/config` (currently `minMargin` 1 USDG, `minNotional` 2 USDG).

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
| `set_trigger` | `market, condition, price, side, margin_usd, leverage, expires_in_hours?` | armed trigger id |
| `list_triggers` / `cancel_trigger` | none / `trigger_id` | the user's conditional bets |
| `my_points` | none | points, notional, leaderboard |
| `make_it_real` | `bet_id` | link to the web app to buy the real token via Flash |

REST for the web app:
- `POST /api/connect/start` `{wallet}` → `{pendingId, agentAddress, expiry}`
- `POST /api/connect/finish` `{pendingId, caps:{maxMarginUsd, maxLeverage, dailyLossUsd}}`
  → verifies `isValidSessionKey(wallet, agentAddress)` onchain → `{mcpUrl}`
- `GET /api/bets?limit=` → public feed of bets placed through the connector
- `POST /api/flash/quote`, `POST /api/flash/order`, `GET /api/flash/orders?wallet=`:
  thin proxies to Flash that keep the API key server-side.
- `GET /health`

Storage: SQLite (`node:sqlite`), tables `users`, `bets` and `triggers`. A watcher checks prices
every 3 seconds and fires armed triggers through the same caps and signing path, and a sync
job credits points onchain every minute.

### web/ (JackTrade trading UI + Grok pages)

- `/grok` Connect Grok: connect wallet, check balance, sign `RegisterSessionKey` for the
  agent key (relayed gasless via `POST {RELAYER}/action`), set caps, copy the MCP URL.
- `/grok/bets` Grok bets feed with live PnL, plus "via Grok" badges in the trade views.
- `/points` points and leaderboard.
- `/real/$id` Make it real: Flash quote → approve/sign → order → status, with a bracket
  (take-profit / stop-loss) derived from the bet. Long bet → market buy with attached
  bracket. Short bet → limit buy at the short's target.

### contracts/ (JackTradePoints)

Non-transferable ERC-20-style points (JTP). The syncer credits each trader's cumulative
notional; it only ever increases. 10 points per $100 of notional.

## Demo (≤ 4 min)

See `docs/demo-runbook.md`. Hook, Connect Grok, Grok analysis → quote → bet onchain, a
conditional bet, the bet in the app with points, Make it real with Flash, cash out.

## Out of scope

ENS, Chainlink (dropped to focus on Definitive Flash), Grok placing Flash orders from a
server-held wallet, OAuth for the connector.
