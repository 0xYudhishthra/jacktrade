# Pre-existing work

This project is a **Continuity Track** submission. It is an add-on to JackTrade's
bet-against-the-house exchange, which was already live on Robinhood Chain before the
hackathon (deployed under its earlier name, JackTrade).

## What existed before the hackathon (not in this repo)

The exchange's deployed contracts and services on **Robinhood Chain mainnet (chain id 4663)**:

| Piece | Address / URL |
| --- | --- |
| Exchange | `0x698cf1a9220f89ccf6ee75269086288a623ede54` |
| SessionKeyManager | `0xe82bb6f411a9a53170f9c4fff53207eb80b7bb29` |
| BatchExecutor | `0xf612485f65e0ea7109a3eb09ea7e0abfabd167a4` |
| Collateral (USDG) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Relayer API | `https://hmrelayer-production.up.railway.app` |
| Prices API | `https://hmprices-production.up.railway.app` |
| Indexer API | `https://hmindexer-production.up.railway.app` |

The exchange's contracts and backend source are not in this repository. We only call the
deployed contracts and the public APIs above.

### The exchange frontend (imported into `web/`)

`web/` is built on the exchange's **pre-existing web frontend** (React 19, TanStack Router,
wagmi + Reown AppKit, Tailwind, Vite). It was imported unchanged in commit
`Import pre-existing JackTrade frontend (pre-hackathon code, unchanged)`, so `git log -- web`
shows exactly what changed during the hackathon. Only its `frontend/` folder was copied, never
contracts or backend code. Pre-existing in `web/`: the landing page, Trade, Portfolio, House,
Leaderboard, Docs, the wallet / deposit / one-click trading flows, and everything under
`web/src/components/{jacktrade,product,trading,dream,ui}`, `web/src/hooks`, `web/src/context`
and `web/src/lib` (except `web/src/lib/grok`). Contract addresses, the EIP-712 signing format and the market list
are read at runtime from the relayer's public `GET /config`. (The EIP-712 domain names
still read "JackTrade"; they are part of the deployed contracts.)

## What was built during the hackathon (everything in this repo)

- `connector/`: a remote MCP server that turns Grok (and any MCP client) into a trading
  rail: check the house, quote, place and cash out bets, read points.
- `web/` additions on top of the imported frontend: Connect Grok (`/grok`), the Grok bets
  feed (`/grok/bets`), JackTrade Points (`/points`, replacing the HOUSE token page), "Make it
  real" (`/real/$id`), which turns a bet into a Definitive Flash advanced order on the real
  token, and a "via Grok" badge on Grok's positions and trades. Code: `web/src/routes/{grok,
  grokBets,points,real}.jsx`, `web/src/lib/grok/`, `web/src/components/grok/`,
  `web/src/grok.css`, plus small marked edits (rebrand to JackTrade, nav, routes, configurable
  block explorer, badges).
- `cre/`: a Chainlink CRE workflow ("Proof of House") that attests the house's bankroll and
  payout queue onchain, plus its consumer contract.
- JackTrade Points (10 points per $100 of notional, win or lose), computed from onchain
  trade history.
- `docs/`: the spec, runbook and prompts used to build it.

The full commit history of this repository starts at the hackathon. The imported frontend arrives as one
clearly labelled commit; every change to it after that is a separate, visible commit.
