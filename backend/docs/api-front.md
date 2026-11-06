# API para el front

> **Referencia completa en inglés, con ejemplos y botones para probar:** `https://hmindexer-production.up.railway.app/docs` (también en `indexer/src/api/docs.html`).

Datos de cuenta, posiciones, historial, mercados y stats de la casa. Va en el mismo servidor que el indexer: lo histórico sale de lo indexado, y lo que cambia con cada bloque (balance libre, caja de la casa) se lee de la cadena en el momento. Precios en vivo: [precios-front.md](precios-front.md). Abrir y cerrar: [intents-front.md](intents-front.md).

## Resumen

| Qué | Dónde |
| --- | --- |
| Base | `http://localhost:8096` en local · producción: `https://hmindexer-production.up.railway.app` |
| Cuenta | `GET /api/account/:user` |
| Posiciones abiertas | `GET /api/positions/:user` |
| Vista previa de cierre | `GET /api/preview/:positionId` |
| Historial | `GET /api/history/:user?cursor=` |
| Mercados | `GET /api/markets` |
| Stats de la casa | `GET /api/stats` |
| Ranking | `GET /api/leaderboard/positions` y `GET /api/leaderboard/accounts` (ver [leaderboard-frontend.md](leaderboard-frontend.md)); el viejo `GET /api/leaderboard?by=pnl\|volume&limit=50` sigue andando |
| Tasa de JACKTRADE | `GET /api/rate` |
| Fees y límites | `GET /api/config` |
| Feed de actividad (tape, liquidaciones, staking…) | `GET /api/activity?kind=&user=&market=&limit=&cursor=` |
| PnL y equity de una wallet en el tiempo | `GET /api/pnl/:user?window=` |
| Volumen por vela | `GET /api/volume?market=&interval=&from=&to=` |
| Exposición de la casa ahora | `GET /api/house` |
| Totales del protocolo en el tiempo | `GET /api/stats/history?window=&interval=` |
| Token y staking | `GET /api/token` · `GET /api/token/history?window=&interval=` |
| Estado | `GET /ready` (200 cuando terminó de indexar la historia) · `GET /status` (último bloque indexado) |

Para levantarlo en local, desde el repo `backend` (con `HERMES_API_KEY` en `.env`):

```sh
NETWORK=fork pnpm indexer
```

## Formato

- **Montos en USDG** y **precios**: texto decimal (`"20.5"`, `"82309.24"`). No usar `Number` para sumar montos: usar `parseUnits(x, 6)` de viem o un decimal.
- **JACKTRADE**: texto decimal con hasta 18 decimales.
- **Direcciones**: en minúscula. `:user` acepta cualquier formato válido.
- **Tiempos**: segundos unix.
- **Errores**: `{ "code": "…", "message": "…" }` (mensaje en inglés; `code`: `INVALID_REQUEST`, `NOT_FOUND`, `POSITION_NOT_OPEN`, `NO_PRICE`, `RATE_LIMITED`, `INTERNAL_ERROR`) con 400 (parámetro inválido), 404, 409 (posición ya cerrada), 429 (demasiados pedidos), 503 (sin precio de Pyth).
- **Límite**: 60 pedidos de golpe y 20 por segundo por IP.

## Cuenta

```jsonc
// GET /api/account/0xabc…
{
  "user": "0xabc…",
  "balance": "979.12",                     // libre en el Exchange: para abrir o retirar
  "queue": { "waiting": "3.5", "position": 2, "ahead": "12.0" },   // null si no espera nada
  "stats": { "trades": 14, "open": 2, "wins": 6, "losses": 7, "liquidations": 1, "realizedPnl": "-4.21",
             "volume": "28000", "feesPaid": "0.31", "minted": "120.5", "deposited": "1000", "withdrawn": "0" }
}
```

`queue`: las ganancias que la casa no pudo pagar al cerrar esperan en una fila FIFO. `waiting` es lo que le deben al usuario, `position` su lugar (1 = el próximo en cobrar) y `ahead` cuánto hay que pagar antes que a él.

## Posiciones abiertas

```jsonc
// GET /api/positions/0xabc…   (más nueva primero)
[{ "id": "12", "market": "BTC/USD", "instrumentId": 0, "side": "long", "margin": "20", "leverage": 100,
   "entryPrice": "82309.24", "markPrice": "82350.10", "liquidationPrice": "81538.55",
   "pnl": "0.82", "openedAt": 1792370000 }]
```

`pnl` es lo que cobraría neto si cierra ahora, al último precio de Pyth: con zona muerta, impacto y fee, calculado con `PnLMath.settle` como el contrato. Es una estimación: el cierre real usa el precio que se empuje en esa transacción. `markPrice` y `pnl` son `null` si no hay precio de Pyth en ese momento. Para el PnL en vivo con cada precio, conviene llamar a `/api/preview` o recalcular con el websocket de precios; esta lista no cambia sola.

## Vista previa de cierre

```jsonc
// GET /api/preview/12
{ "id": "12", "price": "82350.10",
  "gain": "0.84", "loss": "0", "fee": "0.02",   // ganancia bruta, o pérdida (una de las dos es 0)
  "payout": "0.82", "pnl": "0.82",              // ganancia neta; pnl = payout − loss
  "paidNow": "0.82", "queued": "0",             // de la ganancia, cuánto entra ya y cuánto iría a la fila
  "returned": "20.82" }                         // lo que vuelve al balance libre ya (margen − pérdida + pagado)
```

Si la casa no tiene caja, o ya hay fila, la ganancia va a la fila (`queued`). Mostrarlo antes de que el usuario confirme el cierre.

## Historial

```jsonc
// GET /api/history/0xabc…   (de a 50, más nuevo primero)
{ "items": [
    { "type": "close", "id": "11", "market": "ETH/USD", "side": "short", "margin": "5", "leverage": 20,
      "entryPrice": "2410.43", "exitPrice": "2405.10", "pnl": "0.21", "fee": "0.004",
      "openedAt": 1792369000, "at": 1792370500, "tx": "0x…" },
    { "type": "liquidation", "...": "igual que close; pnl = −margen" },
    { "type": "deposit", "amount": "1000", "activationFee": "1", "at": 1792360000, "tx": "0x…" },
    { "type": "withdraw", "amount": "50", "to": "0x…", "at": 1792365000, "tx": "0x…" }
  ],
  "next": "1792360000" }   // pasar como ?cursor= para la página siguiente; null si no hay más
```

## Mercados

```jsonc
// GET /api/markets
[{ "instrumentId": 0, "name": "BTC/USD", "price": "82350.10", "listed": true, "retired": false, "frozenPrice": null,
   "longOi": "1500", "shortOi": "0", "longOiCap": "250000", "shortOiCap": "250000", "minMargin": "1",
   "maxLeverage": 1000, "volume": "48000", "trades": 25, "open": 2, "liquidations": 1 }]
```

`longOi`/`shortOi` son notional abierto (margen × apalancamiento). Si un lado llega a su cap, el contrato rechaza nuevas posiciones de ese lado. Un mercado `retired` solo permite cerrar, al `frozenPrice`.

## Stats de la casa

```jsonc
// GET /api/stats
{ "trades": 25, "open": 2, "volume": "120000", "fees": "1.9", "housePnl": "12.24",
  "deposits": "5000", "withdrawals": "200",
  "queue": { "total": "0.23", "entries": 1 }, "bankroll": "8.1", "paused": false, "lastHeartbeat": 1792370800 }
```

`bankroll` es la caja libre de la casa para pagar ganancias nuevas: es 0 mientras hay fila. `paused`: si es `true`, no se puede abrir.

## Ranking

```jsonc
// GET /api/leaderboard?by=pnl&limit=50   (by: pnl | volume · limit hasta 100)
[{ "rank": 1, "user": "0xabc…", "realizedPnl": "52.3", "volume": "90000", "trades": 31, "wins": 18 }]
```

## Tasa de JACKTRADE

```jsonc
// GET /api/rate
{ "rate": "100", "trackedLp": "-12.24" }   // JACKTRADE por cada USDG perdido, ahora
```

## También

- `POST /graphql` y `/sql/*` (Ponder): **solo en local/fork** o con `EXPOSE_SQL=1`. En producción están apagados porque aceptan consultas arbitrarias que pueden dejar la API sin servicio. Si el front necesita algo que `/api/*` no da, se agrega un endpoint.
