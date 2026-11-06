# Precios en vivo para el front

Cómo conectar el front al servicio de precios del backend. Los precios son de Pyth, los mismos que usan los contratos para abrir, cerrar y liquidar. La clave de Pyth queda en el backend: el navegador solo recibe precios.

## Resumen

| Qué | Dónde |
| --- | --- |
| Websocket | `ws://localhost:8090` en local · en producción, la URL del servicio en Railway (`wss://…`) |
| Últimos precios (HTTP) | `GET /prices` |
| Historial: velas y ticks | `GET /history` (ver [Historial](#historial)) |
| Estado del servicio | `GET /health` |
| Página de prueba | `http://localhost:8090` |
| Mercados | BTC/USD (`market: 0`) y ETH/USD (`market: 1`). Preview, solo precio y velas: SPY/USD (`market: 100`) y TSLA/USD (`market: 101`); ver [Mercados preview](#mercados-preview) |
| Frecuencia | Un precio por segundo por mercado con el plan actual de Pyth. Puede ser más rápido con otro plan: no asumir un intervalo fijo |

Para levantarlo en local, desde el repo `backend`, con `HERMES_API_KEY` en `.env`:

```sh
pnpm prices:server
```

## Mensajes del websocket

Al conectarse llega un `snapshot` con el último precio de cada mercado. Después llega un `price` por cada precio nuevo.

```json
{ "type": "snapshot", "prices": [ { "market": 0, "name": "BTC/USD", "...": "..." }, { "market": 1, "name": "ETH/USD", "...": "..." } ] }
```

```json
{
  "type": "price",
  "market": 0,
  "name": "BTC/USD",
  "price": "8171003006025",
  "conf": "8005293975",
  "expo": -8,
  "publishTime": 1792294301,
  "usd": 81710.03006025
}
```

| Campo | Tipo | Qué es |
| --- | --- | --- |
| `market` | number | Id del mercado en los contratos (`instrumentId`). Usar este para identificar el mercado, no `name` |
| `name` | string | Nombre para mostrar |
| `price` | string | Precio como entero. Precio real = `price × 10^expo` |
| `conf` | string | Confianza de Pyth, en la misma escala que `price` |
| `expo` | number | Exponente (hoy `-8`) |
| `publishTime` | number | Segundos Unix en que Pyth publicó el precio |
| `usd` | number | `price × 10^expo` ya calculado. **Solo para mostrar** |

`price` y `conf` vienen como string porque no entran en un `number` de JS sin perder precisión. Para mostrar alcanza con `usd`. Para cualquier cuenta que tenga que coincidir con los contratos (precio de liquidación, PnL, `priceLimit` de un intent) hay que usar `BigInt(price)` con `expo`.

## Reglas para el front

- **Reconectar siempre.** Si se corta el websocket, reintentar después de 1 s. Al reconectar llega un `snapshot` nuevo: no hace falta pedir nada.
- **Mostrar cuando un precio está viejo.** Si `Date.now() / 1000 - publishTime` pasa de 5 s, marcar el precio como atrasado y no dejar operar ese mercado. Con apalancamiento de 1000x, un precio viejo es peligroso.
- **Confianza alta = no se puede abrir.** Los contratos rechazan una apertura si `conf / price` supera `maxConfBps` del mercado (hoy 10 bps; ver [AVISOS.md](../AVISOS.md)). Cuando pase eso, deshabilitar el botón de abrir con un mensaje claro en vez de dejar que falle.
- **El precio de la pantalla no es el de ejecución.** La posición se abre con el primer precio de Pyth publicado después de que el usuario firma. Por eso el intent lleva un `priceLimit`: el máximo (long) o mínimo (short) aceptable. Sugerido: 0,5% contra el precio mostrado.
- **No pedir `/prices` en loop.** Para precios en vivo, usar el websocket. `/prices` sirve para la primera carga o para scripts.

## Ejemplo: hook de React

Pensado para el front actual (`src/hooks`). Devuelve el mismo formato que usa `useMarketData`: `{ "BTC-PERP": 81710.03, ... }`.

```js
// src/hooks/useLivePrices.js
import { useEffect, useState } from "react";

const PRICES_WS_URL = import.meta.env.VITE_PRICES_WS_URL ?? "ws://localhost:8090";
const STALE_SECONDS = 5;

// market (id en los contratos) → símbolo del front
const SYMBOLS = { 0: "BTC-PERP", 1: "ETH-PERP" };

export function useLivePrices() {
  const [quotes, setQuotes] = useState({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws;
    let retry;
    let closed = false;

    function connect() {
      ws = new WebSocket(PRICES_WS_URL);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1000);
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const list = msg.type === "snapshot" ? msg.prices : [msg];
        setQuotes((prev) => {
          const next = { ...prev };
          for (const p of list) {
            const symbol = SYMBOLS[p.market];
            if (symbol) next[symbol] = p;
          }
          return next;
        });
      };
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  const now = Date.now() / 1000;
  const prices = Object.fromEntries(Object.entries(quotes).map(([s, p]) => [s, p.usd]));
  const stale = Object.fromEntries(Object.entries(quotes).map(([s, p]) => [s, now - p.publishTime > STALE_SECONDS]));
  const confBps = Object.fromEntries(
    Object.entries(quotes).map(([s, p]) => [s, (Number(p.conf) / Number(p.price)) * 10_000]),
  );

  return { connected, prices, stale, confBps, quotes };
}
```

Para usarlo con los mercados simulados de hoy, tomar los precios reales donde existan y dejar el simulado para el resto:

```js
const { prices: live } = useLivePrices();
const price = live[symbol] ?? simulatedPrice;
```

`stale` se recalcula en cada render. Si la pantalla puede quedarse quieta sin renders, agregar un `setInterval` de 1 s que fuerce uno, para que el aviso de atrasado aparezca aunque no lleguen mensajes.

En `.env` del front:

```sh
VITE_PRICES_WS_URL=ws://localhost:8090
```

## Historial

Para el gráfico: velas para las vistas de tiempo y ticks para que el modo Tick no arranque vacío. Mismo servicio y mismo CORS que `/prices`.

### Velas

```text
GET /history?market=0&interval=15m&from=1792350000&to=1792360000
```

| Parámetro | Valores |
| --- | --- |
| `market` | `0` (BTC) · `1` (ETH), el mismo id del websocket |
| `interval` | `1m` · `5m` · `15m` · `1h` · `4h` · `1d` |
| `from`, `to` | Segundos Unix. Si falta `to`, ahora |

```json
{
  "market": 0,
  "name": "BTC/USD",
  "interval": "15m",
  "candles": [{ "t": 1792350000, "o": 80912.4, "h": 80990.1, "l": 80871.0, "c": 80955.3 }]
}
```

- `t` es la apertura de la vela, alineada en UTC al intervalo.
- Precios en USD como `number`: solo para mostrar, igual que `usd` del websocket.
- De la más vieja a la más nueva, **máximo 500 velas**. Si el rango pide más, vienen las 500 más nuevas.
- Si un período no tiene datos, la vela no viene.
- La última vela puede estar abierta: el front la sigue actualizando con el websocket.

Historia disponible: 1m de al menos 30 días; 1d desde el 29/09/2025. Las velas salen del endpoint de historia de Pyth (no las guardamos nosotros): están desde el primer día, sin precargar nada.

### Ticks

```text
GET /history?market=0&interval=tick&from=<ahora - 60>
```

```json
{ "market": 0, "name": "BTC/USD", "ticks": [{ "t": 1792359940000, "usd": 80940.91 }] }
```

- Hasta los **últimos 300 s**, un precio por segundo, del mismo stream de Pyth que el websocket.
- `t` en **milisegundos** (Pyth publica con resolución de segundos: los últimos tres dígitos son 000).
- Si el servicio se acaba de reiniciar, vienen solo los segundos desde que arrancó.

### Errores

`400 { "error": "…" }` si un parámetro es inválido. `502` si Pyth no respondió (reintentar).

### A tener en cuenta

- **Fuente:** las velas vienen del feed Pro de Pyth (`fixed_rate@1000ms`) y el websocket del feed Core (Hermes). Es la misma fuente, pero puede haber diferencias de centavos entre el cierre de una vela y el tick del mismo momento.
- **Depende del plan de Pyth**, igual que el websocket: si se corta la clave, se corta el historial.
- **NVDA y otros:** por ahora solo BTC y ETH, que son los mercados de los contratos.

## `/health`

Para mostrar el estado del servicio o para monitoreo:

```json
{
  "ok": true,
  "clients": 1,
  "hermes": "conectado",
  "prices": [
    { "name": "BTC/USD", "ageSeconds": 0.7, "stale": false },
    { "name": "ETH/USD", "ageSeconds": 0.7, "stale": false }
  ]
}
```

Responde 200 si todos los precios están frescos y 503 si alguno está atrasado.

## Lo que todavía no está

- URL de producción: se define cuando se despliegue en Railway.
- Más mercados: hoy solo BTC y ETH, que son los que tienen los contratos.

## Mercados preview

SPY/USD (`100`) y TSLA/USD (`101`) se muestran pero no se operan (no están en el contrato). El precio sale solo de Pyth y solo si la clave tiene acceso al feed; no se usa ninguna otra fuente. El servicio prueba el acceso cada 10 minutos y toma el feed solo cuando lo dan.

- Con acceso (hoy TSLA): vienen en `/prices`, el websocket y `/history` con el mismo formato que BTC/ETH, más `preview: true`, `source: "pyth"`, `marketOpen` (hubo un precio en los últimos 2 minutos; Pyth publica también en pre y post-market) y `previousClose` (cierre de la vela diaria anterior de Pyth, referencia del cambio del día).
- Sin acceso (hoy SPY): no aparecen en `/prices` ni en el websocket, y `/history` responde 503 `FEED_UNAVAILABLE`. El front lo muestra como "price feed coming soon".

Los feeds de acciones van en un stream de Hermes aparte del de BTC/ETH: si a uno le falta acceso, Hermes rechaza todo el stream, y eso no puede dejar sin precio al relayer ni al liquidador.
