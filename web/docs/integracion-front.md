# JackTrade: integración del front con el backend

Actualizado el 20/10/2026. Robinhood Chain (chain id 4663).

## URLs de producción

| Servicio | URL | Para qué |
| --- | --- | --- |
| Precios | `https://hmprices-production.up.railway.app` | Websocket de Pyth (`wss://`), `/prices`, `/history` |
| Relayer | `https://hmrelayer-production.up.railway.app` | `/config`, órdenes (`/intent`) y acciones con firma (`/action`) |
| API | `https://hmindexer-production.up.railway.app` | Cuenta, posiciones, historial, mercados, stats, ranking |

```sh
VITE_PRICES_URL=https://hmprices-production.up.railway.app
VITE_RELAYER_URL=https://hmrelayer-production.up.railway.app
VITE_API_URL=https://hmindexer-production.up.railway.app
```

> `VITE_*` se hornea en el build: si cambia, hay que redeployar el front. La URL tiene que llevar `https://`.

Documentación detallada en el repo del backend (privado): `docs/precios-front.md`, `docs/intents-front.md`, `docs/api-front.md`, y el cliente de ejemplo en `docs/examples/`.

**Principio:** el usuario **firma** y el relayer **manda y paga el gas**. El backend no puede mover plata de nadie sin su firma.

## 1. Config

Al arrancar, pedir `GET {RELAYER}/config`. Trae:
- el chain id y las direcciones de los contratos;
- los dominios y tipos EIP-712;
- los mercados con sus límites (`maxLeverage`, `minMargin`, `maxNotional`, `maxConfBps`);
- la **hora de la cadena** (`chainTime`).

**No copiar direcciones ni tipos a mano.**

## 2. Precios en vivo

- Websocket `wss://hmprices-production.up.railway.app`: llega un `snapshot` al conectar y un `price` por cada precio nuevo. **Reconectar siempre** (reintentar a 1 s).
- Precio real = `price × 10^expo`.
  - Para cuentas que tengan que coincidir con el contrato (PnL, liquidación, `priceLimit`), usar `BigInt(price)`.
  - `usd` es solo para mostrar.
- **Precio atrasado:** si tiene más de 5 s, marcarlo así y no dejar operar ese mercado.
- **Confianza alta:** si `conf/price` pasa el `maxConfBps` del mercado, deshabilitar "abrir" (el contrato lo rechaza).
- **Gráfico:**
  - velas: `GET /history?market=0&interval=1m&from=<unix>` (de `1m` a `1d`);
  - ticks de los últimos 300 s: `interval=tick`.

## 3. Session key: operar sin popups

1. **Crear** una clave en el navegador y guardarla en `localStorage`. Nunca mandarla a un servidor.
2. **Registrarla una vez**, de una de dos formas:
   - con una transacción de la wallet (`registerSessionKey`);
   - sin gas: firmar y mandar `POST /action` con `kind: "registerSessionKey"`. Solo si el usuario ya depositó.
3. **Abrir y cerrar** se firman con la session key, sin popup. Dura hasta 30 días.

> **Wallets con EIP-7702** (cuentas "smart" de MetaMask, Coinbase): el Exchange no acepta sus firmas directas para abrir y cerrar; con session key sí. **Siempre operar con session key.**

## 4. Abrir y cerrar

```js
import * as jt from "./client.js"; // docs/examples del repo backend

const config = await jt.loadConfig(import.meta.env.VITE_RELAYER_URL);
const r = await jt.openPosition(config, {
  user, signer,            // wallet del usuario + session key
  instrumentId: 0,         // 0 BTC, 1 ETH
  isLong: true,
  margin: 10_000_000,      // 10 USDG (6 decimales)
  leverage: 50,
  quote,                   // precio del websocket: arma el priceLimit
  slippageBps: 50,         // 0,5%
});
// r = { status: "executed", positionId, price (WAD, 18 decimales), txHash }

await jt.closePosition(config, { user, signer, positionId: r.positionId, isLong: true, quote });
```

| Regla | Por qué |
| --- | --- |
| `signedAt` sale de la hora de la cadena, no de `Date.now()` | El contrato rechaza firmas "del futuro" si el reloj del usuario va adelantado |
| Siempre mandar `priceLimit` | Se ejecuta con el primer precio de Pyth posterior a la firma, no con el de la pantalla |
| Un nonce nuevo por orden | Un nonce usado se rechaza (no hace falta que sean correlativos) |
| Mandar enseguida de firmar | El relayer acepta firmas de hasta 30 s |
| Esperar el resultado | `queued` → `submitted` → `executed` o `failed`; tarda ~1–2 s |

## 5. Acciones con la wallet, sin gas para el usuario

El usuario firma con su **wallet** (popup de firma, no de transacción) y el relayer paga el gas. Acá **no** se aceptan session keys.

| `kind` | Qué hace | Nonce |
| --- | --- | --- |
| `depositPermit` | Deposita USDG con un permit, sin `approve` previo. Mínimo 10 USDG (+1 USDG de activación la primera vez) | `nonces(user)` del contrato **USDG** |
| `withdraw` | Retira del Exchange. Mínimo 10 USDG, salvo que retire todo | El mismo de abrir y cerrar |
| `registerSessionKey` | Registra una session key con una firma | Del SessionKeyManager |
| `stake` / `unstake` / `claim` | Staking de HOUSE (stake sin `approve`) | Del staking |

```js
import { actionTypedData, actionToJson } from "@jt/shared"; // o copiar shared/src/actions.ts del backend

const deadline = BigInt(config.chainTime + 600); // al menos 60 s de margen
const action = { kind: "withdraw", action: { user, to: user, amount: 10_000_000n, nonce, deadline } };
const signature = await walletClient.signTypedData({ account: user, ...actionTypedData(action) });
await fetch(`${RELAYER}/action`, { method: "POST", body: JSON.stringify({ ...actionToJson(action), signature }) });
// 202 { id } → GET /action/:id hasta "executed" o "failed"
```

**Límites:**
- `registerSessionKey`, `stake` y `unstake`: solo para wallets que ya depositaron (`NotActivated`).
- Como mucho 2 acciones esperando por usuario y 20 por día (`RateLimited`).

## 6. Leer datos: la API

| Endpoint | Devuelve |
| --- | --- |
| `GET /api/account/:user` | Balance libre, lugar en la fila y cuánto hay adelante, totales del usuario |
| `GET /api/positions/:user` | Posiciones abiertas, con precio actual, precio de liquidación, PnL neto y `liquidatable` |
| `GET /api/preview/:positionId` | Cuánto cobraría si cierra ahora: lo que entra al balance ya y lo que iría a la fila |
| `GET /api/history/:user?cursor=` | Cierres, liquidaciones, depósitos y retiros, de a 50 (pasar `next` como `cursor`) |
| `GET /api/markets` | OI, límites y volumen por mercado |
| `GET /api/stats` | Totales de la casa |
| `GET /api/leaderboard?by=pnl\|volume` | Ranking |
| `GET /api/rate` | HOUSE por cada USDG perdido |

- Montos y precios vienen como **texto decimal** (`"20.5"`): no sumarlos con `Number`, usar `parseUnits`.
- Decimales: USDG 6, HOUSE 18.
- Las direcciones vienen en minúscula.
- Los tiempos vienen en segundos unix.

## 7. Errores que la UI tiene que manejar

| `code` | Qué mostrar |
| --- | --- |
| `InsufficientBalance` | Ofrecer depositar |
| `PriceUncertain`, `PriceLimitExceeded` | Esperar unos segundos o subir la tolerancia |
| `InvalidLeverage`, `InvalidSize`, `OiCapExceeded` | Validar con los límites de `/config` antes de firmar |
| `PositionLiquidatable` | Ya cruzó su precio de liquidación: la cierra el liquidador |
| `InvalidSignature` | La session key venció o se revocó: crear otra |
| `IntentExpired`, `TooOld`, `NoPrice` | Reintentar |
| `TradingIsPaused`, `MarketNotListed`, `MarketIsRetired` | Deshabilitar el mercado |
| `NotActivated` | Primero depositar |
| `RateLimited` | Esperar |

La lista completa está en `RejectCode` (`shared/src/relayer-api.ts` del backend).

## Checklist para el front

- [ ] Cargar las 3 URLs y leer `/config` al arrancar.
- [ ] Websocket de precios con reconexión, precio atrasado y confianza alta.
- [ ] Session key: crear, registrar (transacción o `/action`), guardar y renovar al vencer.
- [ ] Abrir y cerrar con `priceLimit`, `signedAt` de la cadena y espera del resultado.
- [ ] Depositar con permit y retirar por `/action`.
- [ ] Cuenta, posiciones, historial y preview desde la API.
- [ ] Mensajes para cada error.
- [ ] Probar contra un fork local antes de mainnet (el backend levanta uno con `pnpm fork` y `pnpm setup:fork`).
