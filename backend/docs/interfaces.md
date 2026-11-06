# Interfaces entre piezas (día 2)

Lo que comparten el relayer, el liquidador y el indexer, para poder hacerlos en paralelo. Todo sale de `main` de `jacktrade/contracts`, que es lo desplegado (ABIs en `shared/src/generated`, regeneradas con `pnpm sync:exports`).

```text
                 Hermes (Pyth)
                      │  cada proceso tiene su propia conexión
        ┌─────────────┼──────────────┐
        ▼             ▼              ▼
   prices:server   relayer       liquidador        indexer
   (websocket)   POST /intent   liquidate(ids)   eventos → Postgres → API
        │             │              │                ▲
        ▼             ▼              ▼                │
       front     BatchExecutor ──► Exchange ──── eventos
```

## Qué usa cada pieza

| Pieza | De `@hm/prices` | De `@hm/shared` |
| --- | --- | --- |
| Relayer | `createPriceFeed`, `store.getUpdateAfter` | `intentFromJson`, `recoverIntentSigner`, `SubmitIntentRequest`, `IntentStatus`, `RejectCode`, `intentId` |
| Liquidador | `createPriceFeed`, `store.latest`, `store.getUpdateAfter` | `Position`, `liquidationPrice`, `isLiquidatable`, `pythToWad` |
| Indexer y API | — | `Position`, `liquidationPrice`, tipos de eventos desde las ABIs |
| Front | websocket de precios ([precios-front.md](precios-front.md)) | `intentTypedData` (para firmar), `SubmitIntentRequest`, `IntentStatus`, `RejectCode` |

## Intents (`shared/src/intents.ts`)

- `OpenIntent` y `CloseIntent`: mismos campos y orden que en el contrato. Montos en unidades del colateral (6 decimales), precios en WAD (18 decimales).
- `intentTypedData(intent)`: lo que se le pasa a `signTypedData` de viem. Lo firma la wallet o una session key.
- `recoverIntentSigner(intent, signature)`: quién firmó. Si no es `intent.user`, el relayer consulta `SessionKeyManager.isValidSessionKey(user, signer)`.
- `intentToJson` / `intentFromJson`: los `bigint` viajan como string decimal.

Verificado contra el Exchange en mainnet (`pnpm check:interfaces`): mismo dominio y typehashes, y una firma hecha con `intentTypedData` pasa la verificación del contrato.

## API del relayer (`shared/src/relayer-api.ts`)

| Llamada | Respuesta |
| --- | --- |
| `POST /intent` con `SubmitIntentRequest` (intent en JSON + `signature`) | `202 IntentAccepted` (`{ id, status: "queued" }`) · `400/429 IntentRejected` (`{ status: "rejected", code, message }`) |
| `GET /intent/:id` | `IntentStatus`: `queued` → `submitted` → `executed` o `failed` |

- `id` = `${user}:${nonce}` en minúsculas (`intentId`).
- `code` (`RejectCode`) es estable: el front muestra su propio texto. Los códigos con nombre de error del contrato significan lo mismo que ese error.
- En `executed` de un open viene `positionId`, junto con `price` (WAD) y `publishTime` del precio usado.

## Posiciones y liquidación (`shared/src/positions.ts`)

- `Position`: se arma con `PositionOpened` (`positionId`, `user`, `instrumentId`, `isLong`, `margin`, `leverage`, `entryPrice`).
- `liquidationPrice(pos, bufferBps)`: long, liquidable si precio <= ese valor; short, si precio >= ese valor.
- `isLiquidatable(pos, bufferBps, price)`: igual a `PnLMath.isLiquidatable`. Verificado contra la librería desplegada en 600 casos.
- `pythToWad(price, expo)`: igual a `PriceOracle._toWad`. El contrato compara contra precios en WAD.

## Reglas que salen de los contratos

Cosas que no son obvias y que cada pieza tiene que respetar:

1. **`signedAt` no puede estar en el futuro.** El Exchange revierte con `IntentExpired` si `signedAt > block.timestamp`, o si pasó `intentTtl` (1 h). El reloj del usuario puede estar adelantado: el front debería usar la hora del servidor, y el relayer rechazar con `IntentExpired` si `signedAt` supera la hora del último bloque.
2. **El precio tiene que ser posterior a la firma.** Open y close revierten con `PriceTooOld` si el `publishTime` de Pyth es anterior a `signedAt`. El relayer usa `getUpdateAfter(feeds, max(signedAt del batch))`.
3. **`BatchExecutor.execute` no devuelve el `positionId`.** Solo devuelve `ok[]`. El relayer lo saca del evento `PositionOpened` en los logs de la transacción.
4. **Los fallos individuales no revierten el batch.** Cada llamada que falla emite `CallFailed(index, target, reason)`, con el error truncado a 256 bytes. Se decodifica con la ABI del Exchange y se mapea a `RejectCode`.
5. **El buffer de liquidación es el actual del mercado.** En `main`, la posición no guarda su `liqBufferBps`: el contrato usa el de `marketConfig` al momento de liquidar. Si llega un `MarketConfigSet`, el liquidador recalcula las posiciones de ese mercado.
6. **Pasado el disparo, no se puede cerrar.** `closePositionBySig` revierte con `PositionLiquidatable`. El relayer lo devuelve con ese código y la posición queda para el liquidador.
7. **Confianza.** Open revierte con `PriceUncertain` si `conf / price > maxConfBps`. El relayer lo chequea antes con el precio que va a usar. Ver [AVISOS.md](../AVISOS.md).
8. **Fee de Pyth.** Hoy es 0 en Robinhood Chain, pero el relayer igual consulta `getUpdateFee` y lo manda como `msg.value`.

## Estado de mainnet

Los contratos están desplegados pero sin configurar: sin mercados, sin feeds en el oráculo y sin relayers. Para el día 2 se configura el fork haciéndose pasar por el owner. Antes de lanzar hay que correr `configure.ts` en mainnet.
