# Pre-existing work

This project is a **Continuity Track** submission. It is an add-on to JackTrade, a
bet-against-the-house exchange that was already live before the hackathon.

## What existed before the hackathon (not in this repo)

JackTrade's deployed contracts and services on **Robinhood Chain (chain id 4663)**:

| Piece | Address / URL |
| --- | --- |
| Exchange | `0x698cf1a9220f89ccf6ee75269086288a623ede54` |
| SessionKeyManager | `0xe82bb6f411a9a53170f9c4fff53207eb80b7bb29` |
| JACKTRADE token | `0x10f1fd34d2b3b1b6e5a56b4e08e44d25d9df7a76` |
| Collateral (USDG) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Relayer API | `https://hmrelayer-production.up.railway.app` |
| Prices API | `https://hmprices-production.up.railway.app` |
| Indexer API | `https://hmindexer-production.up.railway.app` |

None of that source code is in this repository. We only call the deployed contracts
and the public APIs above. Contract addresses, the EIP-712 signing format and the
market list are read at runtime from the relayer's public `GET /config`.

## What was built during the hackathon (everything in this repo)

- `connector/`: a remote MCP server that turns Grok (and any MCP client) into a trading
  rail. Grok checks the house, quotes, places and cashes out bets through it.
- `web/`: the Connect Grok flow, the Grok bets feed, and "Make it real", which turns a
  bet into a Definitive Flash advanced order on the real stock token.
- `cre/`: a Chainlink CRE workflow ("Proof of House") that attests the house's bankroll
  and payout queue onchain, plus its consumer contract.
- `docs/`: the spec and planning files used to build it.

The full commit history of this repository starts at the hackathon.
