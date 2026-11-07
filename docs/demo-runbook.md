# Demo runbook

Target: 3:30, hard limit 4:00. Record on a computer (not a phone), at least 720p.

## Before recording (in this order)

1. Connector deployed and reachable: `GET https://<domain>/health` returns `ok: true`.
2. `FLASH_API_KEY` set on the deployment (Make it real can't quote without it).
3. Demo wallet: a plain EOA with ≥ $30 USDG deposited in JackTrade, plus ~$10 of USDG or
   ETH left in the wallet for the Flash order.
4. Open the web app with that wallet, go to **Grok**, approve the key, set limits, and add
   the connector in Grok.
5. **Dry run one real Flash order** ($5–10) through `/real/:id` before recording.
6. Pick the market: ETH (24/7). Use TSLA only during US market hours and only if the
   relayer lists it.
7. Set a username (wallet chip in the header), so the feed and leaderboard show `@you`.

## Scenes

**1. Hook (0:00–0:20).** Landing page: "Markets, on command." Then Grok open. "Everyone
already asks Grok what the news means for a market, then leaves to trade. With JackTrade,
you trade right there, or in our terminal. Same market, same rules."

**2. Connect (0:20–0:45, sped up).** Web app → Grok → connect wallet → approve Grok's key
(one signature, no gas) → limits $25 / 100× / $50 per day → copy link → grok.com →
Connectors → New Connector → Custom → paste. Say: "Grok's key can trade, but it can never
withdraw."

**3. The Grok moment (0:45–1:45).** Prompts:
- "What are people on X saying about ETH this week? Bullish or bearish?"
- "Use JackTrade: check the house, then quote me a $20 long on ETH at 50x."
  (expect `house_status`, then `quote_bet` with the liquidation price and points)
- "Place it." (expect `place_bet` → position id + transaction)
- Click the transaction.

**4. Feed (1:45–2:05).** Web app `/bets`: the trade with the "via Grok" badge and live PnL.
In Grok: "How's my bet?" (`my_bets`).

**5. Make it real with Flash (2:05–2:45).** Click Make it real → buy $10 of the real token
with take-profit / stop-loss attached → sign → order fills onchain. "Trade with Grok,
keep the real thing."

**6. While you sleep (2:45–3:15).** In Grok: "If ETH drops below <a level just under the
price>, short it at 20x with $20." (expect `set_trigger`). Then "What have I got armed?"
(`list_triggers`). If the price crosses during the take, show the fired trade in `/bets`;
otherwise say "JackTrade watches the price every few seconds and fires it through the
same limits."

**7. Close (3:15–3:30).** Optional "Cash out my bet" in Grok, then the Points page.
"Grok is the analyst. JackTrade is the market. Flash makes it real. And every trade earns
points, win or lose."

## Fallbacks

- **Grok plan can't add a custom connector:** add the same link in claude.ai (Settings →
  Connectors → Add custom connector) and say "works in any MCP client"; keep Grok for the
  analysis shot.
- **Trade rejected `NoPrice` / `PriceUncertain`:** retry; for stocks, check market hours.
- **Win bigger than the house bankroll:** it's queued, not lost; `house_status` and the
  House page explain it.
