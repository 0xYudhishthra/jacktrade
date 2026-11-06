# Submission copy

## Short description (max 100 characters)

Let Grok trade the news: leveraged bets on stock tokens from inside the chat, against the house.

## Description (min 280 characters)

Millions of people already ask Grok what the news and X mean for a stock. Then they leave
Grok to trade, and the moment is gone. JackTrade puts the trade inside the conversation.

JackTrade is a bet-against-the-house exchange on Robinhood Chain: you go long or short on
stocks and crypto with up to 1000x leverage, and the house takes the other side. This
project turns it into a rail for AI agents. Add the JackTrade connector to Grok once
(grok.com → Connectors → Custom), and Grok can check the house, quote a bet, place it
onchain, track it and cash out, all from the chat where you did your research.

Picture a retail trader in Kuala Lumpur. US stock tokens are available to them onchain,
but leverage isn't. They ask Grok what tariff headlines mean for Tesla, Grok reads X and
the news, and they say "bet $20 long TSLA at 50x". Grok places it on JackTrade in seconds.

Safety is built in. Grok trades with a session key that can open and close bets but can
never withdraw funds, and the user sets its limits: max bet, max leverage, and a 24-hour
risk budget. They can revoke it from their wallet at any time.

Every Grok bet appears in a public feed. Anyone can follow an agent's call and hit "Make it
real" to copy it into the real token with a Definitive Flash advanced order: a market buy
with an attached take-profit / stop-loss bracket for longs, or a limit buy for shorts.

A Chainlink CRE workflow, "Proof of House", reads the house's bankroll and payout queue
straight from Robinhood Chain, reaches consensus, and writes an attestation onchain. Grok
reads it before every bet, so users know the house is good for it.

Every bet earns JackTrade Points: 10 points per $100 of notional, win or lose.

## How it's made (min 280 characters)

Three new pieces sit on top of JackTrade's exchange contracts, which were already live on
Robinhood Chain mainnet (Continuity Track; no exchange source is in this repo).

**Grok connector (`connector/`).** A remote MCP server in Node 24 + TypeScript, run directly
with Node's built-in type stripping (no build step), Express and the official MCP SDK in
stateless Streamable HTTP mode. Each user gets a secret connector URL; behind it is an
agent key generated server-side and stored AES-256-GCM encrypted in SQLite (`node:sqlite`).
The user registers that key on the exchange's SessionKeyManager with one gasless EIP-712
signature, which the exchange's relayer submits. When Grok calls `place_bet`, the connector
reads the EIP-712 domain, types and markets live from the relayer's public `/config`,
signs an `Open` intent with viem (chain-time `signedAt`, random nonce, slippage-bounded
WAD price limit), posts it to the relayer and polls until it executes onchain. Caps are
enforced before signing, because session keys have no onchain limits. Hacky but notable:
the connector also serves the web app on the same origin, so the whole product is one
Docker image and one URL.

**Make it real with Definitive Flash (`web/`).** Vite + React + viem, no wallet SDK. For a
long bet we request a Flash `market` quote with `attachedBracket` (take-profit and
stop-loss derived from the bet's liquidation distance) on the real Robinhood Chain token
(TSLA and NVDA stock tokens, WETH for ETH). For a short we place a `limit` buy at the
target. The user approves (ERC-20 or Permit2, whichever the quote returns), signs the
entry and bracket typed data, and Flash executes onchain. The Flash API key never reaches
the browser: the connector proxies `/v1/quote`, `/v1/order` and `/v1/orders`.

**Proof of House with Chainlink CRE (`cre/`).** A TypeScript CRE workflow on a cron
trigger. Robinhood Chain isn't a CRE-supported chain, so the workflow uses the HTTP
capability to send one batched JSON-RPC `eth_call` to the Exchange
(`lpBankrollAvailable`, `totalQueued`, `lpCash`, `totalMargin`) and fetches open interest
from the indexer. Nodes reach consensus, and the report is written through the CRE
forwarder to our `HouseAttestation` consumer contract (Foundry, 5 tests) on Ethereum
Sepolia. The connector's `house_status` tool reads `latest()` back, so Grok quotes a
Chainlink-attested bankroll before you bet.

**JackTrade Points** are computed from onchain notional (via the indexer), 10 per $100,
win or lose, so anyone can recompute them.

## Partner prize notes

**Definitive:** Flash powers "Make it real": `market` + `attachedBracket` (TP/SL) and
`limit` orders on Robinhood Chain stock tokens and WETH, signed in the user's wallet and
executed onchain by Flash. Social: a public feed of agent (Grok) bets that anyone can follow
and copy with one Flash order; Grok hands out the copy link itself (`make_it_real` tool).

**Chainlink:** CRE workflow (cron → HTTP JSON-RPC reads of a non-CRE chain + HTTP API →
consensus → EVM write to a consumer on Sepolia). It is the product's trust layer: the
connector's `house_status` tool reads the attestation and Grok quotes it before betting.

## X post

Grok can now trade the news.

Ask Grok what the headlines mean for $TSLA, say "bet $20 long at 50x", and JackTrade places
it onchain from the chat. Followers can make it real with one @DefinitiveFi Flash order,
and a @chainlink CRE workflow proves the house can pay.

Built at @ETHGlobal Mumbai. [video] [repo]
