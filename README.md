# JackTrade

Read the news in Grok. Bet on it in the same chat.

JackTrade is a Grok connector that lets you bet against the house with
leverage, without leaving the conversation where you did your research.

- **Ask Grok** what the news means for a market.
- **Tell Grok** "bet $20 long ETH at 50x". Grok checks the house, quotes the bet and
  places it onchain on Robinhood Chain.
- **Make it real.** Anyone following a Grok bet can copy it into the real token with a
  Definitive Flash advanced order: a market buy with a take-profit / stop-loss bracket
  attached, or a limit buy for short calls.
- **Proof of House.** A Chainlink CRE workflow attests the house's bankroll and payout
  queue onchain, and Grok reads it before betting, so you know the house is good for it.

Grok's trading key can open and close bets but can never withdraw your money, and you
set its limits: max bet, max leverage, and a 24-hour risk budget.

## How it works

```
Grok ──MCP──▶ connector ──signed intent──▶ JackTrade relayer ──▶ Exchange (Robinhood Chain)
                 │  ▲
                 │  └── reads Proof of House ◀── HouseAttestation (Sepolia) ◀── Chainlink CRE workflow
                 │                                                                   ▲
web app ─────────┴── Flash proxy ──▶ Definitive Flash ──▶ real token on Robinhood Chain │
                                                     Robinhood Chain RPC + indexer ──┘
```

1. **Connect Grok** (web app): connect a wallet that has a JackTrade balance, approve
   Grok's key with one gasless signature, set limits, and copy your personal connector URL.
2. **Add it to Grok**: grok.com → Connectors → New Connector → Custom → paste the URL.
3. **Bet from the chat.** Grok gets seven tools: `list_markets`, `house_status`,
   `quote_bet`, `place_bet`, `my_bets`, `cash_out`, `make_it_real`.

## How we use Definitive Flash

"Make it real" (`web/src/pages/Real.jsx`) turns a leveraged Grok bet into a real position
in the underlying token on Robinhood Chain (chain key `robinhood`):

- **Long bet → market buy with an attached bracket.** Take-profit and stop-loss are derived
  from the bet's liquidation distance and are editable. If Flash returns no bracket payload
  the app refuses to place an unprotected order.
- **Short bet → limit buy** at the short's target, so a bearish call becomes "buy the dip".
- Tokens: TSLA and NVDA Robinhood stock tokens, WETH for ETH bets. Pay with USDG or ETH
  (native ETH is wrapped first, per Flash's `wrap` step).
- Flow: `POST /v1/quote` → approve / Permit2 as the quote requires → sign
  `evm.orderTypedData` (and the bracket's) → `POST /v1/order` → poll `/v1/orders`.
- The Flash API key stays server-side: the connector proxies `/api/flash/*`
  (`connector/src/server.ts`).
- Social angle: the public Grok bets feed (`/bets`) lets anyone follow an agent's calls and
  copy them with one Flash order. Grok itself hands out the link via the `make_it_real` tool.

## How we use Chainlink CRE

`cre/proof-of-house/` is a CRE workflow (TypeScript SDK) that acts as the house's auditor:

- **Trigger:** cron.
- **Reads:** JackTrade's Exchange on Robinhood Chain over JSON-RPC (`lpBankrollAvailable`,
  `totalQueued`, `lpCash`, `totalMargin`, batched in one HTTP call; Robinhood Chain is not a
  CRE-supported chain, so it is read through the HTTP capability) and open interest and
  position count from JackTrade's indexer.
- **Consensus** across nodes, then an ABI-encoded report.
- **Writes** the report to `HouseAttestation` (`cre/contracts/src/HouseAttestation.sol`) on
  Ethereum Sepolia through the CRE forwarder.
- **Used by the product:** the connector's `house_status` tool reads `latest()` from the
  contract, so Grok quotes the Chainlink-attested bankroll before you bet.
- Run it: see [cre/README.md](cre/README.md) (`cre workflow simulate ./proof-of-house
  --target staging-settings --broadcast`).

## Run it

```bash
# one service: connector + web app
docker build -t jacktrade-grok .
docker run -p 8787:8787 -v hmg:/data \
  -e SERVER_SECRET=$(openssl rand -hex 32) \
  -e PUBLIC_URL=http://localhost:8787 \
  -e FLASH_API_KEY=... \
  -e ATTESTATION_ADDRESS=0x... \
  jacktrade-grok
```

Development: `connector/` (`npm install && npm run dev`, env in `connector/.env.example`)
and `web/` (`bun install && bun run dev`, env in `web/.env.example`).

## Repo

| Folder | What |
| --- | --- |
| `connector/` | Remote MCP server (the Grok connector), REST API, Flash proxy |
| `web/` | Connect Grok, Grok bets feed, Make it real |
| `cre/` | Chainlink CRE Proof of House workflow + consumer contract |
| `docs/` | Spec, demo runbook, prompts |

This is a Continuity Track project: see [PRE-EXISTING.md](PRE-EXISTING.md) for what it
builds on, and [docs/AI_USAGE.md](docs/AI_USAGE.md) for how AI tools were used.
