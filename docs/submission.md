# Submission copy

Plain sentences, no colons, ready to paste into the ETHGlobal form.

## Short description

Grok reads the news and places leveraged stock token bets for you on JackTrade, right in the chat

## Description

Lots of people already ask Grok what the news means for a stock before they trade. Then they have to leave Grok, open another app and place the trade themselves, and by then the moment has usually passed. JackTrade lets Grok do it for them in the same chat.

JackTrade is a bet against the house exchange on Robinhood Chain. You go long or short on stock tokens like TSLA and SPY, or on ETH and BTC, with up to 1000x leverage, and the house takes the other side. We built a Grok connector on top of it. You add it to Grok once and then Grok can check the house, quote a bet, place it onchain, track it and cash out. You can also ask Grok to watch a level, like shorting TSLA at 20x with $20 if it drops below $350, and JackTrade fires the bet the moment the price crosses, even if you are not around.

Think of a retail trader in Kuala Lumpur who follows Tesla on X. They can hold US stock tokens onchain but there is no simple way to use leverage on them. With JackTrade they ask Grok what the tariff headlines mean, make up their mind, and Grok places the trade in seconds.

Grok never gets access to your money. It trades with a session key that can open and close bets but can never withdraw, and you set its limits for bet size, leverage and how much it can risk in a day. You can revoke it from your wallet at any time.

Every bet Grok places shows up in a public feed in the JackTrade app. Anyone can follow a call and hit Make it real to copy it into the actual stock token with a Definitive Flash order. Longs become a market buy with take profit and stop loss attached, so the copy is protected from the start, and shorts become a limit buy below the market.

Every trade also earns JackTrade Points, 10 points for every $100 of notional whether you win or lose. Points live onchain in a non transferable contract so they are ready for a future token launch.

Everything runs on Robinhood Chain mainnet with real funds. We tested the full path end to end, from a gasless deposit and connecting Grok, to bets on ETH and TSLA placed and cashed out through Grok's tools, a liquidation, points credited onchain, and a Make it real order that bought the real TSLA token through Flash with its bracket active.

## How it's made

The bet against the house exchange existed before the hackathon, so this is a Continuity Track project. During the event we redeployed it on Robinhood Chain mainnet with new logic, where losses no longer mint a lose to earn token and every trade earns points instead, and we ran a fresh backend for it on Railway with its own relayer, Pyth price service, Ponder indexer, keepers and liquidator.

The Grok connector is a remote MCP server written in TypeScript on Node 24 with Express and the official MCP SDK in stateless Streamable HTTP mode. Each user gets a private connector URL that they paste into Grok's custom connectors. Behind that URL sits an agent key that we generate on the server and keep encrypted with AES-256-GCM in SQLite. The user registers that key with the exchange's session key manager using one gasless signature from their wallet. When Grok calls place_bet, the connector reads the signing format and market list from our relayer, checks the user's limits, signs the order with viem and waits until it lands onchain. Session keys have no onchain limits, so we enforce the caps ourselves before anything gets signed.

Conditional bets run on a small watcher inside the connector. It checks prices every few seconds and fires an armed bet through the same path as a manual one, so the same limits always apply, and each trigger is claimed atomically so it can never fire twice.

Definitive Flash powers Make it real. A long bet turns into a Flash market order with an attached bracket for take profit and stop loss, set from how far the bet was from liquidation. A short bet turns into a limit buy below the current price. The follower approves and signs in their own wallet, Flash routes the order through venues like Uniswap V4 on Robinhood Chain, and the real TSLA, NVDA or WETH lands in their wallet. The Flash API key stays on our server behind a small proxy so it never reaches the browser, and the app refuses to place a long without its protective bracket.

Points are tracked by our JackTradePoints contract on Robinhood Chain, a non transferable ERC-20 style ledger with 19 Foundry tests. A sync job credits each trader every minute from their onchain notional, and the contract only ever adds, so re-running it is safe.

The web app is the JackTrade trading UI, redesigned during the event with a dark theme, the Jack mascot and new pages for connecting Grok, the agent bets feed with "via Grok" badges, points and Make it real. The connector also serves the built web app, so the whole product ships as one Docker image on Railway.

## Definitive Flash, how we used it

We use Flash so anyone can copy a Grok bet into the real stock token on Robinhood Chain with one order. Longs use a market order with an attached take profit and stop loss bracket and shorts use a limit order, all signed in the user's own wallet and executed onchain by Flash.

## X post

Grok can now trade the news for you.

Ask Grok what the headlines mean for $TSLA, tell it to bet $20 long at 50x, and JackTrade places it onchain right from the chat. Anyone following can copy the call into the real stock with one @DefinitiveFi Flash order.

Built at @ETHGlobal Mumbai. [video] [repo]
