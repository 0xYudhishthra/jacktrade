# JackTrade: web app

Read the news in Grok. Bet on it in the same chat.

Vite + React + viem. No wallet SDK: it talks to the injected browser wallet (`window.ethereum`)
and adds / switches to Robinhood Chain (id 4663) automatically.

## Pages

| Route | What |
| --- | --- |
| `/` | **Connect Grok.** Connect wallet → check JackTrade balance → approve Grok's trading key (one gasless signature, relayed by JackTrade) → set limits → copy your private connector URL into Grok. Also: revoke Grok's key. |
| `/bets` | **Grok bets.** Live feed of bets placed through the Grok connector (polls every 5 s). |
| `/real/:id` | **Make it real.** Copy a Grok bet into the real token on Robinhood Chain with a Definitive Flash order. Long → market buy with an attached take-profit / stop-loss bracket. Short → limit buy below the market. |

Grok's key can open and close bets. It can never withdraw your money.

## Environment

Copy `.env.example` to `.env` and adjust:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_CONNECTOR_URL` | `http://localhost:8787` | Grok connector (connect flow, bets feed, Flash proxy) |
| `VITE_RELAYER_URL` | `https://hmrelayer-production.up.railway.app` | JackTrade relayer (`/config`, `/action`) |
| `VITE_INDEXER_URL` | `https://hmindexer-production.up.railway.app` | JackTrade indexer (`/api/account/:user`) |
| `VITE_PRICES_URL` | `https://hmprices-production.up.railway.app` | JackTrade prices (live PnL on open bets) |
| `VITE_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` | Robinhood Chain RPC |
| `VITE_EXPLORER_URL` | empty | Block explorer base URL (no trailing slash). Empty = tx hashes shown as plain text. |

The Flash API key never reaches the browser: the connector proxies `POST /api/flash/quote`,
`POST /api/flash/order` and `GET /api/flash/orders?wallet=` and adds it server-side.

## Run

```bash
bun install
bun run dev      # http://localhost:5173
bun run build    # outputs dist/
bun run preview
```

## Deploy (Vercel)

1. New Project → import the repo → **Root Directory: `web`**.
2. Framework preset: Vite. Build command `bun run build` (or `npm run build`), output `dist`.
3. Add the `VITE_*` environment variables above (at minimum `VITE_CONNECTOR_URL` pointing at the
   deployed connector).
4. Deploy. `vercel.json` rewrites every path to `index.html`, so deep links like `/real/42`
   (which Grok's `make_it_real` tool hands out) work.

CLI alternative: `cd web && vercel --prod`.

## How "Make it real" works

1. Load the bet from the connector, map its market to a real token on Robinhood Chain
   (TSLA, NVDA stock tokens; ETH → WETH; BTC has no token here, so it defaults to TSLA and says so).
2. Price the token with a small Flash quote, then derive the order from the bet's leverage:
   liquidation distance ≈ 1 / leverage (clamped 0.5%–20%).
   - Long: market buy, take-profit at +2× that distance, stop-loss at that distance.
   - Short: limit buy that distance below the current price.
   All prices are editable.
3. Quote through the connector (`/v1/quote` body, `funderAddress` = your wallet).
4. Send whatever the quote asks for: `wrap.evmTx` (paying with native ETH), `evm.approveTx`
   (spend token), `attachedBracket.evm.approveTx` (bought token, so the exits can sell it).
   After any onchain step the app re-quotes so the signed payloads are fresh.
5. Sign `evm.orderTypedData` (and `attachedBracket.evm.orderTypedData` for the bracket, plus any
   Permit2 payloads), submit to `/v1/order`, then poll `/v1/orders` for status.
