# JackTrade for Grok: spec

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
3. **Proof of House (Chainlink CRE).** A workflow that reads the house's bankroll and
   payout queue from Robinhood Chain and JackTrade's indexer, then writes an
   attestation to a consumer contract. Grok's `house_status` tool reads it, so Grok
   can say whether the house is good for a bet before placing it.

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
- Market minimums from `/config`: `minMargin` 10 USDG, `minNotional` 20 USDG.

MCP endpoint: `POST|GET|DELETE /mcp/:token` (Streamable HTTP, stateless).

MCP tools:

| Tool | Input | Output |
| --- | --- | --- |
| `list_markets` | none | markets with live price, max leverage, open/closed |
| `house_status` | none | bankroll, payout queue, open interest, latest Chainlink attestation |
| `quote_bet` | `market, side, margin_usd, leverage` | entry, notional, liquidation price, cap check, house warning |
| `place_bet` | `market, side, margin_usd, leverage, max_slippage_pct?` | position id, fill price, tx link |
| `my_bets` | none | open positions with PnL and liquidation price |
| `cash_out` | `position_id` | exit price, tx link |
| `make_it_real` | `position_id?, market?` | link to the web app to buy the real token via Flash |

REST for the web app:
- `POST /api/connect/start` `{wallet}` → `{pendingId, agentAddress, expiry}`
- `POST /api/connect/finish` `{pendingId, caps:{maxMarginUsd, maxLeverage, dailyLossUsd}}`
  → verifies `isValidSessionKey(wallet, agentAddress)` onchain → `{mcpUrl}`
- `GET /api/bets?limit=` → public feed of bets placed through the connector
- `POST /api/flash/quote`, `POST /api/flash/order`, `GET /api/flash/orders?wallet=`:
  thin proxies to Flash that keep the API key server-side.
- `GET /health`

Storage: SQLite (`node:sqlite`), tables `users` and `bets`.

### web/ (Vite + React + viem)

- `/` Connect Grok: connect wallet (EOA), check JackTrade balance, sign
  `RegisterSessionKey` for the agent key (relayed gasless via `POST {RELAYER}/action`),
  set caps, copy the MCP URL with Grok setup steps.
- `/bets` Grok bets feed with live PnL.
- `/real/:betId` Make it real: Flash quote → approve/sign → order → status, with a
  bracket (take-profit / stop-loss) derived from the bet. Long bet → market buy with
  attached bracket. Short bet → limit buy at the short's target.

### cre/ (Chainlink CRE, TypeScript workflow + Foundry contract)

- Trigger: cron.
- HTTP: Robinhood Chain JSON-RPC `eth_call` for the Exchange's bankroll and queue
  getters; JackTrade indexer `/api/house` for open interest and stress numbers.
- Consensus: median / identical aggregation.
- EVM write: `HouseAttestation` consumer on a CRE-supported testnet (Robinhood Chain is
  not supported by CRE), storing `{bankroll, queued, openInterest, observedAt}`.
- Verified with `cre workflow simulate --broadcast`.

## Demo (≤ 4 min)

1. Hook in Grok. 2. Connect Grok (sped up). 3. Grok analysis → `house_status` →
`quote_bet` → `place_bet` → tx on Robinhood Chain. 4. Bet shows in the feed. 5. A
follower clicks Make it real → Flash order lands onchain. 6. CRE simulation writes
Proof of House; contract value matches what Grok quoted. 7. Close.

## Out of scope

ENS, CCIP, Grok placing Flash orders from a server-held wallet, OAuth for the connector.
