# JackTrade web app

> **Continuity Track note.** This folder is the pre-existing JackTrade exchange
> frontend, imported unchanged in the commit "Import pre-existing JackTrade frontend (pre-hackathon code,
> unchanged)". Hackathon additions: `/grok` (Connect Grok), `/grok/bets` (Grok bets feed), `/points`
> (JackTrade Points, replacing the HOUSE token page), `/real/$id` (Make it real with Definitive Flash) and a
> "via Grok" badge on positions and trades. New code lives in `src/routes/{grok,grokBets,points,real}.jsx`,
> `src/lib/grok/`, `src/components/grok/` and `src/grok.css`; see `git log -- web` for every change.
>
> Build-time env (all optional): `VITE_CONNECTOR_URL` (default: same origin; `http://localhost:8787` in dev),
> `VITE_EXPLORER_URL` (empty: tx hashes as text), `VITE_REOWN_PROJECT_ID` (empty: browser-wallet list),
> `VITE_PRICES_URL` / `VITE_RELAYER_URL` / `VITE_API_URL` / `VITE_RPC_URL` (default: live services).

---

# Exchange frontend (pre-existing) · DREAM.EXE

Complete DREAM.EXE frontend from the 8018 iteration, on `main` and `frontend-v3`.

React 19, TanStack Router, Vite 8 and Tailwind CSS 3. Requires Node >=22.12 and Bun.

## Development

```sh
bun install --frozen-lockfile
bun run dev
```

Local: http://localhost:8018. The server uses a strict port; reuse an existing 8018 server or stop it before starting another checkout.

```sh
bun run check  # strict lint, model/history tests and production build
```

## Design and motion

White glass terminal with Grok, Trade, Portfolio, House, Points and Leaderboard. The landing uses a mouse-steered point vortex, floating transparent landscape mirrors and bubbles, lowercase Figtree branding, textured 1000x lettering, a broad ripple field and an animated trading preview.

Motion runs by default. `?motion=system` follows the device preference, `?motion=reduced` pauses decorative motion, and `?motion=full` enables it explicitly. Touch input does not activate pointer gravity. Decorative animation pauses when hidden or outside the viewport.

## Protocol integration

The terminal reads live prices, protocol configuration, indexed accounts, positions, history, markets, statistics and leaderboards from the production services. Wallet actions use Robinhood Chain (chain ID 4663). Orders are signed with a browser-generated session key and submitted through the relayer; deposits and withdrawals require wallet signatures.

Copy `.env.example` to `.env.local` only when overriding the production defaults. The frontend never needs backend or contract source checkouts.

The landing preview and explicitly labeled sample rows remain illustrative. Markets whose relayer configuration reports `listed: false` stay visible but disabled; the frontend enables them automatically after the protocol lists them.

The order ticket requires at least 10 USDG margin and a 1,000 USDG position. Leverage starts at 10× and advances in 10× steps; with 10 USDG margin, 100× reaches the minimum position. Stricter market limits from `/config` still apply. These are frontend checks; the protocol's onchain limits must be aligned separately before listing markets.

## Deployment

Deployed with the Grok connector: the root `Dockerfile` builds this app and the connector serves it. SPA rewrites for static hosts are in `vercel.json`. Font licenses are included under `public/fonts/`.
