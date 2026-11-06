# Operar desde el front: session keys e intents

Cómo abre y cierra posiciones el front. El usuario **no paga gas y no ve popups** al operar: firma con una session key que vive en el navegador y el relayer manda las órdenes a la cadena.

Todo lo de esta guía está en un cliente de ejemplo, listo para copiar: [`docs/examples/jacktrade-client.js`](examples/jacktrade-client.js). Se prueba contra el relayer real con `pnpm try:front-client` en este repo.

## El flujo

```text
1. Conectar wallet ──► 2. Crear session key ──► 3. Registrarla (1 transacción de la wallet)
                                                         │
4. Abrir / cerrar: firma la session key, sin popup ◄─────┘
   POST /intent ──► queued ──► submitted ──► executed (positionId, precio)
                                         └─► failed (code)
```

La wallet aparece **una vez**, para registrar la session key, que dura hasta 30 días. Después todo es sin popup.

## Qué hay que instalar

```sh
bun add viem
```

Y en `.env` del front:

```sh
VITE_RELAYER_URL=http://localhost:8091
```

## 1. Cargar la config

```js
import * as hm from "./jacktrade-client.js";

const config = await hm.loadConfig(import.meta.env.VITE_RELAYER_URL);
```

`GET /config` devuelve todo lo necesario para firmar: `chainId`, direcciones del Exchange y del SessionKeyManager, el dominio y los tipos EIP-712, los mercados con sus límites (`maxLeverage`, `minMargin`, `maxNotional`…) y la **hora de la cadena** (`chainTime`).

No copiar direcciones ni tipos a mano: si cambian los contratos, cambia la config.

## 2. Session key

```js
// Una vez por dispositivo. Guardar privateKey en el navegador (localStorage); nunca mandarla a un servidor.
const key = hm.createSessionKey();

// Única transacción con la wallet. walletClient: createWalletClient({ transport: custom(window.ethereum) })
await hm.registerSessionKey(walletClient, config, key.address); // por defecto, el máximo (30 días)

const signer = hm.sessionKeyAccount(key.privateKey);
```

- La session key **solo puede abrir y cerrar posiciones**: no puede retirar fondos. Si se pierde o roba, lo peor es que opere con el saldo del usuario. El usuario la revoca con `revokeSessionKey` o `revokeAllSessionKeys` desde su wallet.
- Antes de operar, conviene chequear con `hm.isValidSessionKey(publicClient, config, user, key.address)` que no venció. Si venció, se crea y registra otra.
- **Ojo con EIP-7702:** si la wallet del usuario tiene una delegación 7702 (cuentas "smart" de MetaMask, Coinbase, etc.), el Exchange no acepta firmas de intents hechas directamente con la wallet. Con session key sí funciona, porque la registra una transacción normal. Por eso **siempre operar con session key**.

## 3. Abrir

```js
const quote = livePrices.quotes["BTC-PERP"]; // { price, expo } del websocket de precios

const result = await hm.openPosition(config, {
  user,               // dirección de la wallet del usuario (no la de la session key)
  signer,             // la session key
  instrumentId: 0,    // 0 BTC, 1 ETH (el `market` del websocket)
  isLong: true,
  margin: 10_000_000, // 10 USDG (6 decimales)
  leverage: 100,      // notional = margen × leverage ≥ 1000 USDG
  quote,              // para el priceLimit; si no se pasa, no hay límite
  slippageBps: 50,    // tolerancia: 0,5% (default)
});
// result: { status: "executed", positionId: "12", price: "81026420000000000000000", txHash, publishTime }
```

`price` es el precio de entrada real, en WAD (18 decimales). Para mostrar: `Number(result.price) / 1e18`.

## 4. Cerrar

```js
await hm.closePosition(config, { user, signer, positionId: "12", isLong: true, quote });
```

`isLong` es el lado de la posición: cerrar un long es vender, así que el `priceLimit` se invierte solo.

## 5. Acciones con la wallet (sin gas para el usuario)

Depositar, retirar, registrar una session key y el staking también los manda el relayer: el usuario **firma** con su wallet (un popup de firma, no de transacción) y el relayer paga el gas. Estas acciones **no aceptan session keys**: las firma siempre la wallet.

```js
import { actionTypedData, actionToJson, actionId } from "@hm/shared"; // o copiar actions.ts del backend

const deadline = BigInt(config.chainTime + 600); // 10 minutos; el relayer pide al menos 60 s de margen
const action = { kind: "withdraw", action: { user, to: user, amount: 10_000_000n, nonce: nextNonce(), deadline } };
const signature = await walletClient.signTypedData({ account: user, ...actionTypedData(action) });
const res = await fetch(`${RELAYER}/action`, { method: "POST", body: JSON.stringify({ ...actionToJson(action), signature }) });
// 202 { id, status: "queued" } → GET /action/:id hasta "executed" o "failed"
```

| `kind` | Campos de `action` | Qué hace | Nonce |
| --- | --- | --- | --- |
| `withdraw` | `user, to, amount, nonce, deadline` | Retira del Exchange a `to` | El mismo de abrir y cerrar (no repetir) |
| `depositPermit` | `user, amount, nonce, deadline` | Deposita USDG con un permit EIP-2612, sin `approve` previo | `nonces(user)` del contrato de **USDG** |
| `registerSessionKey` | `user, key, expiry, epoch, nonce, deadline` (`epoch` = `SessionKeyManager.epochOf(user)`) | Registra una session key con una firma (en vez de una transacción) | Propio del SessionKeyManager |
| `stake` / `unstake` | `user, amount, nonce, deadline` | Stakea o saca JACKTRADE (stake no necesita `approve`) | Propio del staking |
| `claim` | `user, nonce, deadline` | Cobra las recompensas de staking al balance del Exchange | Propio del staking |

- Montos: USDG con 6 decimales; JACKTRADE con 18.
- `depositPermit`: la primera vez se cobra la fee de activación; el mínimo es `minDeposit` (+ esa fee).
- `withdraw`: mínimo `minWithdraw`, salvo que retire todo el balance. El relayer descuenta lo que reservan órdenes en fila.
- `registerSessionKey`: `expiry` entre ahora y 30 días. Con esto la wallet no paga gas ni para la primera session key.
- `claim` se rechaza con `NothingToClaim` si no hay nada para cobrar (así el relayer no gasta gas en vano).
- Límites (cada acción le cuesta gas al relayer): `registerSessionKey`, `stake` y `unstake` solo para wallets que ya depositaron (`NotActivated`); como mucho 2 acciones esperando por usuario y 20 por día (`RateLimited`).
- Errores nuevos: `NotActivated`, `SignatureExpired`, `BelowMinimum`, `InvalidKey`, `InvalidExpiry`, `InsufficientStake`, `NothingToClaim`, `ZeroAmount` (además de `InvalidSignature`, `NonceAlreadyUsed`, `InsufficientBalance`).
- El `id` va todo en minúsculas: `depositpermit:0xabc…:3`.

## Reglas que el front tiene que respetar

| Regla | Por qué |
| --- | --- |
| **`signedAt` sale de la hora de la cadena** (`chainNow(config)`), no de `Date.now()` | El contrato rechaza firmas "del futuro" (`IntentExpired`). El reloj del usuario puede estar adelantado |
| **Siempre mandar `priceLimit`** (lo arma `openPosition` si le pasás `quote`) | La orden se ejecuta con el primer precio de Pyth posterior a la firma, no con el que se ve en pantalla. Sin límite, un salto de precio entra igual |
| **Nonce nuevo por orden** (`newNonce()`) | Un nonce usado se rechaza (`NonceAlreadyUsed`). No hace falta que sean correlativos |
| **Mandar la orden enseguida de firmarla** | El relayer acepta firmas de hasta 30 s (`TooOld` si pasan más) |
| **Esperar el resultado** (`waitForIntent`, lo hacen `openPosition` y `closePosition`) | `queued` solo significa que entró a la fila; puede fallar después en la cadena |
| **Deshabilitar "abrir" si la confianza del precio pasa `maxConfBps`** | El contrato lo rechaza (`PriceUncertain`). La confianza viene en el websocket |

## Estados

| Estado | Qué significa |
| --- | --- |
| `queued` | Pasó la validación y espera el próximo batch (cada 200 ms) |
| `submitted` | El batch se mandó a la cadena (`txHash`) |
| `executed` | Se ejecutó: `positionId` y `price` (entrada si abrió, salida si cerró) |
| `failed` | No se ejecutó: `code` y `message` |

De `queued` a `executed` tarda ~1 a 2 s.

## Errores

`hm.openPosition` y `hm.closePosition` tiran `RelayerError` con `code` y un `message` en inglés para mostrar (`REJECT_MESSAGES` en el cliente; se puede cambiar el texto).

| `code` | Cuándo | Qué hacer en la UI |
| --- | --- | --- |
| `InsufficientBalance` | Margen mayor que el saldo libre | Ofrecer depositar |
| `InvalidLeverage`, `InvalidSize` | Fuera de los límites del mercado (vienen en `config.markets`; margen mínimo 10 USDG, notional mínimo 1000 USDG) | Validar antes en el formulario |
| `PriceUncertain` | La confianza de Pyth supera `maxConfBps` | Esperar unos segundos |
| `PriceLimitExceeded` | El precio se movió más que la tolerancia | Reintentar o subir `slippageBps` |
| `IntentExpired`, `TooOld`, `NoPrice` | Problemas de tiempo | Reintentar |
| `PositionLiquidatable` | Al cerrar: la posición ya cruzó su precio de liquidación | Avisar que la va a cerrar el liquidador |
| `OiCapExceeded` | Se llenó el límite de posiciones de ese lado | Probar más tarde |
| `TradingIsPaused`, `MarketNotListed`, `MarketIsRetired` | Mercado no disponible | Deshabilitar el mercado |
| `InvalidSignature` | La session key no vale (venció o se revocó) | Crear y registrar otra |
| `RateLimited` | Más de 5 órdenes por segundo | Esperar |

La lista completa está en `RejectCode` (`shared/src/relayer-api.ts`).

## API del relayer

| Llamada | Para qué |
| --- | --- |
| `GET /config` | Contratos, EIP-712, mercados, límites y hora de la cadena |
| `POST /intent` | `{ kind: "open" \| "close", intent, signature }` con los números como string. Responde `202 { id, status: "queued" }` o `400/429 { status: "rejected", code, message }` |
| `GET /intent/:id` | Estado del intent. `id` = `${user}:${nonce}` en minúsculas |
| `POST /action` | `{ kind, action, signature }` (ver sección 5). Responde igual que `/intent` |
| `GET /action/:id` | Estado de la acción. `id` = `${kind}:${user}:${nonce}` en minúsculas |
| `GET /health` | Estado del relayer |

Puerto en local: **8091** (`NETWORK=fork pnpm relayer`). La URL de producción se define al desplegar.

## Lo que todavía no está

- **Listado de posiciones abiertas e historial:** ya está en la API del indexer ([api-front.md](api-front.md)).
- **Revocar una session key desde el front:** es una transacción de la wallet con `revokeSessionKey(key)` en el SessionKeyManager.
