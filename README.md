# JackTrade for Grok

Read the news in Grok. Bet on it in the same chat.

JackTrade for Grok is a Grok connector that lets you bet against the house on stocks
and crypto with leverage, without leaving the conversation where you did your research.

- **Ask Grok** what the news means for TSLA.
- **Tell Grok** "bet $20 long TSLA at 50x". Grok checks the house, quotes the bet and
  places it onchain.
- **Make it real.** Anyone following a Grok bet can copy it into the real stock token
  with a Definitive Flash advanced order (market + take-profit / stop-loss bracket).
- **Proof of House.** A Chainlink CRE workflow attests the house's bankroll and payout
  queue onchain, so you (and Grok) know the house is good for it.

Grok's trading key can open and close bets but can never withdraw your money, and you
set the limits.

## Repo

| Folder | What |
| --- | --- |
| `connector/` | Remote MCP server (the Grok connector) |
| `web/` | Connect Grok, bets feed, Make it real |
| `cre/` | Chainlink CRE Proof of House workflow + consumer contract |
| `docs/` | Spec and planning files |

See [PRE-EXISTING.md](PRE-EXISTING.md) for what this builds on, and
[docs/AI_USAGE.md](docs/AI_USAGE.md) for how AI tools were used.
