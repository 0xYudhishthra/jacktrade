# Demo runbook

Target 3:30, hard limit 4:00. Record on a computer (not a phone), at least 720p.

## Before recording

1. App is up: `GET https://jacktrade.up.railway.app/health` returns `ok: true`, and
   the relayer's `/health` returns `ok: true`.
2. Demo wallet: a plain EOA with a few USDG deposited in JackTrade (minimum bet is $1) and a
   few dollars of USDG or ETH left in the wallet for the Flash order.
3. Connect Grok at `/grok` with that wallet, add the connector URL in Grok
   (grok.com → Connectors → New Connector → Custom).
4. Dry run one real Flash order through `/real/<betId>` before recording.
5. Market: ETH or BTC trade 24/7. TSLA and SPY only trade while Pyth's US equity feeds are
   open (weekdays, roughly 14:30 to 06:30 IST).

## Scenes

**1. Hook (0:00–0:20).** A retail trader in Kuala Lumpur follows Tesla on X. They can hold US
stock tokens onchain but can't put leverage on them. "Everyone already asks Grok what the news
means. JackTrade lets Grok place the bet, right in the chat."

**2. Connect (0:20–0:45, sped up).** `/grok` → connect wallet → approve Grok's key (one
signature, no gas) → set limits → copy the URL → add it in Grok. Say: "Grok's key can bet, but
it can never withdraw."

**3. The Grok moment (0:45–1:45).** Prompts:
- "What are people on X saying about ETH this week? Bullish or bearish?"
- "Use JackTrade. Check the house, then quote me a $2 long on ETH at 50x."
  (expect `house_status`, then `quote_bet` with entry, liquidation price and points)
- "Place it." (expect `place_bet` → position id + transaction)

**4. Grok watches a level (1:45–2:10).** "If ETH drops 1% from here, short it 50x with $2."
(expect `set_trigger`). Show `list_triggers`. If the price crosses during recording, the bet
appears on its own.

**5. In the app (2:10–2:30).** `/grok/bets` and the Trade page: the bet with the "via Grok"
badge and live PnL. `/points`: points earned, 10 per $100 of notional, win or lose.

**6. Make it real with Definitive Flash (2:30–3:10).** Click Make it real → buy a few dollars
of the real token with take profit and stop loss attached → sign → Flash executes onchain.
"Bet with Grok, keep the real thing."

**7. Close (3:10–3:30).** "Cash out my bet" in Grok. "Grok is the analyst. JackTrade is the
rail. Flash makes it real."

## Fallbacks

- **Grok plan can't add a custom connector:** add the same URL as a custom connector in
  claude.ai and say "works in any MCP client"; keep Grok for the analysis shot.
- **Bet rejected `NoPrice` / `PriceUncertain`:** retry; for stocks, check market hours.
- **Win bigger than the house bankroll:** it's queued, not lost; `house_status` explains it.
