# Submission copy

Plain sentences, no colons, written to paste straight into the ETHGlobal form.

## Short description

Grok reads the news and places leveraged stock token bets for you on JackTrade, right in the chat

## Description

Lots of people already ask Grok what the news means for a stock before they trade. The problem is they then have to leave Grok, open another app and place the trade themselves, and by then the moment has usually passed. JackTrade lets Grok do it for them in the same chat.

JackTrade is a bet against the house exchange on Robinhood Chain. You go long or short on stock tokens and crypto with leverage and the house takes the other side. We built a Grok connector on top of it. You add it to Grok once and then Grok can check the house, quote a bet, place it onchain, track it and cash out. You can also ask Grok to watch a level, like shorting TSLA at 20x with $20 if it drops below $350, and JackTrade fires the bet the moment the price crosses even if you are not around.

Think of a retail trader in Kuala Lumpur who follows Tesla on X. They can hold US stock tokens onchain but there is no simple way to use leverage on them. With JackTrade they ask Grok what the tariff headlines mean, make up their mind, and Grok places the trade in seconds.

Grok never gets access to your money. It trades with a session key that can open and close bets but can never withdraw, and you set the limits for bet size, leverage and how much it can risk in a day. You can revoke it from your wallet at any time.

Every Grok bet shows up in a public feed in the JackTrade app. Anyone can follow a call and hit Make it real to copy it into the actual stock token with a Definitive Flash order, with take profit and stop loss attached so the copy is protected from the start.

Every trade also earns JackTrade Points, 10 points for every $100 of notional whether you win or lose, so active traders are rewarded ahead of a future token launch.

## How it's made

JackTrade's exchange contracts were already live on Robinhood Chain mainnet before the hackathon, so this is a Continuity Track project. Everything described here was built during the event.

The Grok connector is a remote MCP server written in TypeScript on Node 24 with Express and the official MCP SDK. Each user gets a private connector URL that they paste into Grok's custom connectors. Behind that URL sits an agent key that we generate on the server and keep encrypted in SQLite. The user registers that key with the exchange's session key manager using one gasless signature from their wallet. When Grok calls place_bet, the connector pulls the signing format and market list from the exchange's public relayer, checks the user's limits, signs the order with viem and waits until it lands onchain. Session keys have no onchain limits, so we enforce the caps ourselves before anything gets signed.

Conditional bets run on a small watcher inside the connector. It checks the exchange's Pyth prices every few seconds and fires an armed bet through the exact same path as a manual one, so the same limits always apply.

Definitive Flash powers Make it real. A long bet turns into a Flash market order with an attached bracket for take profit and stop loss, set from how far the bet was from liquidation. A short bet turns into a limit buy below the current price. The user approves and signs in their own wallet, Flash routes and executes the order onchain on Robinhood Chain, and the real TSLA, NVDA or WETH lands in their wallet. The Flash API key stays on our server behind a small proxy so it never reaches the browser.

The web app is the existing JackTrade trading UI extended with pages for connecting Grok, the Grok bets feed, points and Make it real. Points are tracked by a new non transferable JackTrade Points contract on Robinhood Chain that our server keeps in sync with each trader's onchain volume.

The whole thing ships as one Docker image on Railway because the connector also serves the web app from the same origin.

## Definitive Flash, how we used it

We use Flash so anyone can copy a Grok bet into the real stock token on Robinhood Chain with one order, using market orders with an attached take profit and stop loss bracket for longs and limit orders for shorts.

## X post

Grok can now trade the news for you.

Ask Grok what the headlines mean for $TSLA, tell it to bet $20 long at 50x, and JackTrade places it onchain right from the chat. Anyone following can copy the call into the real stock with one @DefinitiveFi Flash order.

Built at @ETHGlobal Mumbai. [video] [repo]
