# Demo runbook

Target: 3:30, hard limit 4:00. Record on a computer (not a phone), at least 720p.

## Before recording (in this order)

1. Connector deployed and reachable: `GET https://<domain>/health` returns `ok: true`.
2. Deploy `HouseAttestation` to Sepolia (`cre/README.md`), set `ATTESTATION_ADDRESS` on the
   deployment, redeploy.
3. Run `cre workflow simulate ./proof-of-house --target staging-settings --broadcast` once.
   Check `GET /health` now shows an `attestation`. If you skip this, Grok will say
   "No Chainlink attestation published yet" in scene 3.
4. Demo wallet: a plain EOA with ≥ $30 USDG deposited in JackTrade, plus ~$10 of USDG or
   ETH left in the wallet for the Flash order.
5. Connect Grok on the web app with that wallet, add the connector in Grok.
6. **Dry run one real Flash order** ($5–10) through `/real/:id` before recording.
7. Pick the market: ETH (24/7). Use TSLA only if JackTrade's relayer lists it.

## Scenes

**1. Hook (0:00–0:20).** Grok open. "Everyone already asks Grok what the news means for a
market, then leaves to trade. JackTrade puts the bet inside Grok, against the house."

**2. Connect (0:20–0:45, sped up).** Web app → connect wallet → approve Grok's key (one
signature, no gas) → limits $25 / 100x / $50 per day → copy URL → grok.com → Connectors →
New Connector → Custom → paste. Say: "Grok's key can bet, but it can never withdraw."

**3. The Grok moment (0:45–1:45).** Prompts:
- "What are people on X saying about ETH this week? Bullish or bearish?"
- "Use JackTrade: check the house, then quote me a $20 long on ETH at 50x."
  (expect `house_status` with the Chainlink attestation, then `quote_bet`)
- "Place it." (expect `place_bet` → position id + transaction)
- Click the transaction.

**4. Feed (1:45–2:05).** Web app `/bets`: the bet with the "via Grok" badge and live PnL.
In Grok: "How's my bet?" (`my_bets`).

**5. Make it real with Flash (2:05–2:45).** Click Make it real → buy $10 of the real token
with take-profit / stop-loss attached → sign → order fills onchain. "Play with JackTrade,
keep the real thing."

**6. Proof of House (2:45–3:15).** Terminal: `cre workflow simulate ... --broadcast` →
logs show the Robinhood Chain reads, consensus, and the Sepolia write. Then
`cast call <HouseAttestation> "latest()(uint256,uint256,uint256,uint256,uint64)"` shows the
same bankroll Grok quoted in scene 3.

**7. Close (3:15–3:30).** Optional "Cash out my bet" in Grok. "Grok is the analyst. House
Money is the rail. Flash makes it real. Chainlink keeps the house honest."

## Fallbacks

- **Grok plan can't add a custom connector:** add the same URL in claude.ai (Settings →
  Connectors → Add custom connector) and say "works in any MCP client"; keep Grok for the
  analysis shot.
- **Bet rejected `NoPrice` / `PriceUncertain`:** retry; for stocks, check market hours.
- **Win bigger than the house bankroll:** it's queued, not lost; `house_status` explains it.
