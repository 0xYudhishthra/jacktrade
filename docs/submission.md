# Submission copy (drafts)

## Short description (≤ 100 chars)

Bet against the house from inside Grok, then make it real with Flash. Chainlink keeps it honest.

## Description

People already use Grok to read the news and X and form a view, then leave Grok to trade.
JackTrade for Grok puts the trade in the chat. It's a remote MCP connector: add it to
Grok once, and Grok can check the house, quote a leveraged bet, place it onchain on
Robinhood Chain against JackTrade's house, and cash out, all from the conversation.

Grok trades with a session key that can open and close bets but can never withdraw, with
limits the user sets (max bet, max leverage, 24h risk budget).

Every Grok bet shows up in a public feed. Anyone can follow it and hit "Make it real" to
copy the call into the real token with a Definitive Flash advanced order: a market buy with
an attached take-profit / stop-loss bracket for longs, a limit buy for shorts.

A Chainlink CRE workflow, "Proof of House", reads the house's bankroll and payout queue
straight from Robinhood Chain plus open interest from the indexer, reaches consensus, and
writes an attestation onchain. Grok reads it before every bet, so users know the house is
good for it.

## What's new vs reused (Continuity Track)

Reused: JackTrade's already-deployed exchange contracts and public APIs on Robinhood
Chain (no source in this repo). New during the hackathon: everything in the repo, i.e. the
Grok connector, the web app (Connect Grok, bets feed, Make it real with Flash), and the
Chainlink CRE workflow and consumer contract. See PRE-EXISTING.md.

## Partner prize notes

**Definitive:** Flash powers "Make it real": market + attachedBracket (TP/SL) and limit
orders on Robinhood Chain stock tokens and WETH, signed in the user's wallet, executed
onchain by Flash. Social: a public feed of agent (Grok) bets that anyone can follow and
copy with one Flash order; Grok hands out the copy link itself.

**Chainlink:** CRE workflow (cron → HTTP JSON-RPC reads of a non-CRE chain + HTTP API →
consensus → EVM write to a consumer on Sepolia). It's the trust layer of the product: the
connector's `house_status` tool reads the attestation and Grok quotes it before betting.

## X post

Grok can now bet against the house.

Ask Grok what the news means for ETH, tell it "bet $20 long at 50x", and it places the bet
onchain from the chat. Followers can make it real with one @DefinitiveFi Flash order, and a
@chainlink CRE workflow proves the house can pay.

Built at @ETHGlobal Mumbai. [video] [repo]
