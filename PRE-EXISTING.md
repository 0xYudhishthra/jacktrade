# Pre-existing work

JackTrade is a **Continuity Track** submission. The bet-against-the-house exchange behind
it existed before the hackathon. This page lists exactly what was reused and what was new.

## Reused from before the hackathon

- **Exchange contract code.** The bet-against-the-house exchange (Exchange, PriceOracle,
  SessionKeyManager, BatchExecutor, PnL math) was written before the event. Its source is
  kept private and is not in this repository.
- **Backend services** in `backend/` (prices, relayer, indexer, keepers, liquidator),
  imported in a single clearly labelled commit. Internal audit notes and ops runbooks were
  left out on purpose.
- **Trading frontend** in `web/`, imported in a single clearly labelled commit.

## Built during the hackathon

- **A fresh deployment of the exchange on Robinhood Chain mainnet** with new logic. Losses
  no longer mint a lose-to-earn token. Every trade earns JackTrade Points instead, 10 points
  per $100 of notional, win or lose. Contract signing domains were renamed to JackTrade.
- **`contracts/`** JackTradePoints, the non-transferable onchain points ledger, with tests.
- **`connector/`** the Grok connector (remote MCP server). Grok can check the house, quote,
  place and cash out bets, arm conditional bets that fire when a price crosses, and read
  points. It also syncs points onchain and proxies Definitive Flash.
- **Grok features in `web/`** Connect Grok, the Grok bets feed with "via Grok" badges,
  JackTrade Points, and Make it real (copy a bet into the real stock token with a
  Definitive Flash advanced order).
- **New backend deployment** of the services above on Railway, with new keys and a new
  Ponder indexer.
- **`docs/`** the spec, runbook, submission copy and prompts used to build it.

Everything outside the two labelled import commits was written during the hackathon, and
the commit history shows it step by step.
