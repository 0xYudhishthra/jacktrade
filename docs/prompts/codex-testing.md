# Codex prompt: testing pass

Paste everything below the line into Codex, run from the repo root.

---

You are testing a hackathon project, "JackTrade for Grok", in this repository (read
`docs/spec.md` and `README.md` first). It has:

- `connector/`: Node 24 + TypeScript (run directly with `node src/server.ts`, no build), an
  Express server with a stateless MCP endpoint at `POST /mcp/:token`, REST routes under
  `/api/*`, and SQLite via `node:sqlite`. Upstreams are JackTrade's live public APIs
  (relayer, prices, indexer) and Definitive Flash.
- `web/`: Vite + React + viem single-page app served by the connector in production.

Goal: add automated tests that prove the product works, without touching real money.

1. **Connector unit tests** in `connector/test/*.test.ts` using `node:test` (run with
   `npm test` in `connector/`). Mock `fetch` for every upstream. Cover:
   - `resolveMarket`: "btc", "BTC/USD", "bitcoin" resolve; an unlisted ticker (e.g. TSLA
     when the relayer only lists BTC and ETH) returns a clear "not open yet" error that lists
     open markets.
   - `quote`: liquidation price math (`liquidationPrice` in `src/trading.ts`) for long and
     short at 2x, 50x, 1000x; cap enforcement (max margin, max leverage, 24h risk budget);
     market minimums from the relayer config.
   - `placeBet`: builds an `Open` intent that matches the relayer's EIP-712 types from
     `/config`, signs it with the agent key (verify with viem `recoverTypedDataAddress`),
     sends decimal strings for uint fields, sets `priceLimit` above mark for longs and below
     for shorts, and records the bet. Cover the `failed` intent path.
   - `cashOut`: `Close` limits are inverted vs open (long min exit, short max exit).
   - `crypto.ts`: encrypt/decrypt round-trip; wrong secret fails.
   - Server: `POST /api/connect/finish` refuses when `isValidSessionKey` is false (mock the
     RPC), accepts when true, and the returned MCP URL works for `initialize` and
     `tools/list` (7 tools). Unknown token → 404.
   - Flash proxy: `?wallet=` is rewritten to `funderAddress`, the API key header is added,
     and upstream status codes pass through.
2. **Live read-only smoke test** script `connector/test/smoke.live.ts` (not part of
   `npm test`): starts the server with a temp DB and a seeded fake user, then calls MCP
   `list_markets`, `house_status`, `quote_bet` against the real APIs. It must NOT call
   `place_bet` or `cash_out` and must not submit any Flash order.
3. **Web**: make sure `bun run build` passes in `web/`; add a small unit test for any pure
   helpers (e.g. bracket take-profit/stop-loss math in `src/pages/Real.jsx` if extractable).

Rules:
- Never place real bets or Flash orders. Never print or commit secrets (`.env` files).
- Don't change product behaviour. If a test exposes a real bug, fix it in a separate commit
  with a clear message and mention it in your summary.
- Commit in small steps with clear messages (`git pull --rebase` before each push).
- Finish with a summary: tests added, pass/fail counts, bugs found.
