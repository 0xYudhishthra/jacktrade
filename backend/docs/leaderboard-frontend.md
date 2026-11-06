# JackTrade leaderboard: frontend integration

Two tabs, **Positions** (best closed trades) and **Accounts** (ranked traders), each with a time window: `24h`, `7d`, `30d` or `all`. Usernames come from profiles ([profiles-frontend.md](profiles-frontend.md)).

## Base URL

| Environment | URL |
| --- | --- |
| Production | `https://jt-indexer-production.up.railway.app` |
| Local fork | `http://localhost:8096` (`NETWORK=fork pnpm indexer`) |

## Conventions

- Amounts in USDG as decimal strings (`"1234.56"`), prices as decimal strings, JACKTRADE (`minted`) with 18 decimals already applied. Parse with `parseUnits`/`Number` as you need; do not do math on floats for money.
- `roi` and `winRate` are percentages as numbers with 2 decimals (`161.33` means +161.33 %). `null` when it cannot be computed (no closed margin / no trades).
- Addresses in lowercase. Times in Unix **seconds**.
- Strict query: only the documented params, each once. Anything else is `400 INVALID_REQUEST` with a `message` that says what is wrong. Build the query with `URLSearchParams` and omit params that have their default value.
- Responses carry `Cache-Control: public, max-age=1, must-revalidate` and an `ETag`. Polling every few seconds is fine; the browser revalidates for you (`304` when nothing changed).

## Windows

`window` = `24h` | `7d` | `30d` | `all` (default `all`). A position counts in a window by its **close time**; volume counts by **open time**.

## `GET /api/leaderboard/positions?window=7d`

Top 15 closed positions by realized PnL in USDG, biggest first. No paging. The same wallet can appear more than once. Liquidations are included (`liquidated: true`).

```json
{
  "window": "7d",
  "positions": [
    {
      "rank": 1,
      "id": "42",
      "user": "0x3c44...93bc",
      "username": "house.trader",
      "market": "BTC/USD",
      "instrumentId": 0,
      "side": "long",
      "leverage": 76,
      "margin": "75000",
      "notional": "5700000",
      "entryPrice": "82514.5",
      "exitPrice": "84524.5",
      "pnl": "121421.31",
      "roi": 161.89,
      "liquidated": false,
      "openedAt": 1792500000,
      "closedAt": 1792586400
    }
  ]
}
```

`roi` = `pnl / margin`. It rewards high leverage, so show it as a secondary column; the order is by `pnl`.

## `GET /api/leaderboard/accounts?page=0&q=&sortDir=desc&sortKey=volume&window=7d`

| Param | Values | Default |
| --- | --- | --- |
| `window` | `24h`, `7d`, `30d`, `all` | `all` |
| `page` | `0`, `1`, … (25 rows per page, fixed) | `0` |
| `q` | Search, up to 42 chars: part of an address or a username (case-insensitive) | none |
| `sortKey` | `rank`, `user`, `pnl`, `roi`, `unrealizedPnl`, `realizedPnl`, `volume`, `trades`, `winRate`, `openNotional`, `queued`, `stakingRewards`, `minted`, `lastActive` | `rank` |
| `sortDir` | `asc`, `desc` | `asc` for `rank`/`user`, `desc` for the rest |

```json
{
  "window": "7d",
  "count": 1240,
  "summary": {
    "accounts": 1240,
    "ranked": 1102,
    "trades": 8731,
    "volume": "48210000",
    "pnl": "-125400.5",
    "openNotional": "3120000",
    "queued": "0"
  },
  "accounts": [
    {
      "rank": 1,
      "user": "0x3c44...93bc",
      "username": "house.trader",
      "pnl": "52300.12",
      "roi": 34.5,
      "trades": 31,
      "wins": 18,
      "winRate": 58.06,
      "volume": "900000",
      "realizedPnl": "61200.4",
      "unrealizedPnl": "-1200.5",
      "openNotional": "45000",
      "queued": "0",
      "stakingRewards": "12.3",
      "minted": "1050.25",
      "lastActive": 1792586400
    }
  ],
  "pageInfo": { "page": 0, "pageSize": 25, "totalPages": 50 }
}
```

### Fields

| Field | Meaning |
| --- | --- |
| `rank` | **Fixed rank** by `pnl` in the window. It does not change when you sort by another column. `null` if the account only opened positions in the window (nothing closed yet): show "–" |
| `pnl` | Realized PnL of positions closed in the window. **The ranking metric** |
| `roi` | `pnl` / margin of those closed positions, in % |
| `trades`, `wins`, `winRate` | Positions closed in the window, how many with profit, and the ratio in % |
| `volume` | Notional opened in the window |
| `realizedPnl` | All-time realized PnL (same as `pnl` with `window=all`) |
| `unrealizedPnl` | **Estimate** of the open positions at the current Pyth price (linear, loss capped at the margin, without fees and price impact). `null` if a market has no current price. The exact figure per position is `GET /api/preview/:id`. Not used for the rank |
| `openNotional` | Notional of open positions now |
| `queued` | USDG waiting in the winners' queue |
| `stakingRewards` | Staking rewards credited, all time (USDG) |
| `minted` | JACKTRADE earned, all time |
| `lastActive` | Last on-chain activity |

`summary` is for the header: accounts active in the window, how many are ranked, closed trades, volume and total PnL of the window, plus protocol-wide open notional and queue right now. `count` is the number of rows after the search (`q`), for the pager.

### Who is in the table

Accounts with at least one position opened or closed in the window. With `window=all`, everyone who ever traded.

## Errors

Same shape as profiles:

```json
{ "code": "INVALID_REQUEST", "message": "sortKey must be one of: rank, user, pnl, ..." }
```

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Unknown or repeated param, bad value |
| 429 | `RATE_LIMITED` | Too many requests from the same IP |
| 500 | `INTERNAL_ERROR` | Unexpected; retry |

## Example

```js
const API = import.meta.env.VITE_API_URL;

export async function getAccounts({ window = "all", page = 0, q = "", sortKey = "rank", sortDir } = {}) {
  const params = new URLSearchParams();
  if (window !== "all") params.set("window", window);
  if (page) params.set("page", String(page));
  if (q.trim()) params.set("q", q.trim());
  if (sortKey !== "rank") params.set("sortKey", sortKey);
  if (sortDir) params.set("sortDir", sortDir);
  params.sort(); // one URL per view
  const res = await fetch(`${API}/api/leaderboard/accounts?${params}`);
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.message), { code: body.code });
  return body;
}

export async function getTopPositions(window = "all") {
  const res = await fetch(`${API}/api/leaderboard/positions${window === "all" ? "" : `?window=${window}`}`);
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.message), { code: body.code });
  return body.positions;
}
```

## UI notes

- Show `username` when present; otherwise the short address. Link both to `/u/:username` (or the address).
- Mobile: keep `rank`, user, `pnl`; hide `unrealizedPnl`, `queued`, `stakingRewards`, `minted`, `lastActive` first.
- Label `unrealizedPnl` as "est." or "unrealized (est.)".
- Debounce the search box (~300 ms) and reset `page` to 0 when `q`, `window` or the sort change.

## The old endpoint

`GET /api/leaderboard?by=pnl|volume&limit=50` still works (all-time only) so the current front does not break. Move to `/api/leaderboard/accounts`; the old one will be removed later.

## Frontend checklist

- [ ] Tabs Positions / Accounts and the window selector (`24h`, `7d`, `30d`, `all`).
- [ ] Positions: 15 rows, notional, ROI %, liquidated badge.
- [ ] Accounts: 25 per page with `pageInfo`, search `q`, sort by column with `sortKey`/`sortDir`, fixed `rank` (show "–" for `null`).
- [ ] Header with `summary`.
- [ ] Usernames from the response (no extra calls).
- [ ] Map errors with `code`, show `message` by default.
