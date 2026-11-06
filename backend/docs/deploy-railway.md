# Deploy en Railway

Una sola imagen (`Dockerfile`) para los cinco servicios, más un Postgres. Cada servicio elige su comando en `railway/<servicio>.json`. Va en la **cuenta de Railway del proyecto**. Cada push a `main` redeploya.

## Servicios

| Servicio | Config file path | Dominio público | Para qué |
| --- | --- | --- | --- |
| prices | `/railway/prices.json` | Sí (el front se conecta por websocket) | Precios de Pyth en vivo e historial |
| relayer | `/railway/relayer.json` | Sí (el front manda los intents firmados) | Abre y cierra posiciones |
| liquidator | `/railway/liquidator.json` | **No** | Liquida posiciones |
| keepers | `/railway/keepers.json` | **No** | `heartbeat` y `harvest` |
| indexer | `/railway/indexer.json` | Sí (la API del front) | Indexer y API |
| Postgres | (Add → Database → PostgreSQL) | No | Base del indexer |

En cada servicio, en **Settings**:

1. **Source → Root Directory:** vacío (`/`). El Dockerfile necesita el repo entero. Si Railway puso `/relayer` o similar, borrarlo.
2. **Qué comando corre.** Hay tres formas, y alcanza con una (ojo: Railway marcó "Config as Code" como deprecado y ya no deja asignar `railway/*.json` por la API; hoy los servicios usan Custom Start Command, y el reinicio `ALWAYS` y los health checks — `/health` en prices, `/ready` con 900 s en el indexer — están cargados en cada servicio):
   - **Config-as-code → Railway Config File:** el path de la tabla.
   - **Deploy → Custom Start Command:** `pnpm prices:server`, `pnpm relayer`, `pnpm liquidator`, `pnpm keepers` o `pnpm indexer`. Es lo que usamos en el primer deploy.
   - Ninguna de las dos: `scripts/start.sh` elige solo por el nombre del servicio (`RAILWAY_SERVICE_NAME`, por ejemplo `@hm/liquidator`) o por la variable `SERVICE`.
3. **Networking:** generar dominio solo en prices, relayer e indexer. Hoy: prices `jt-prices-production.up.railway.app`, relayer `jt-relayer-production.up.railway.app`, indexer `jt-indexer-production.up.railway.app` (con Postgres: `DATABASE_URL=${{Postgres.DATABASE_URL}}`).
4. **Watch paths:** cada servicio mira su carpeta y las comunes (`/shared/**`, `/prices/**` si la usa, `/Dockerfile`, `/.dockerignore`, `/package.json`, `/pnpm-lock.yaml`, `/pnpm-workspace.yaml`, `/tsconfig.json`, `/scripts/start.sh`, `/railway/**`). Railway los había puesto solo en la carpeta del servicio, y saltaba (SKIPPED) los commits que tocaban solo `shared/`: así no llegaron las alertas en el primer push.
5. **Deploys:** branch `main`, con deploy automático en cada push. Si no lo toma, en Deployments usar **Cmd+K → "Deploy Latest Commit"**. "Redeploy" sobre un deploy viejo reusa ese commit.

Con un **Project Token** del proyecto (`RAILWAY_TOKEN` en el `.env` local, nunca en el repo) se puede deployar un commit, leer logs y estado y cambiar la config por la API de Railway (`https://backboard.railway.com/graphql/v2`, header `Project-Access-Token`).

## Variables

Conviene cargar las comunes como **Shared Variables** del proyecto y referenciarlas en cada servicio. Las claves privadas van **solo** en su servicio, nunca en el repo ni en un chat.

**Comunes (todos los servicios):**

| Variable | Valor |
| --- | --- |
| `NETWORK` | `mainnet` |
| `RPC_URL` | RPC privado (Alchemy u otro) |
| `TRUST_PROXY` | `1` (Railway pone un proxy delante; sin esto, el límite por IP vería a todos como la misma IP) |

**Con precios de Pyth** (prices, relayer, liquidator, indexer):

| Variable | Valor |
| --- | --- |
| `HERMES_URL` | `https://pyth.dourolabs.app/hermes` |
| `PYTH_HISTORY_API_KEY` | Solo en **prices**, opcional: otra clave de Pyth para `/history`. Si alguien abusa del historial y Pyth la frena, los precios del relayer y el liquidador siguen | 
| `HERMES_API_KEY` | La clave de Pyth (la prueba vence alrededor del 2026-11-19 (Pyth dio un mes gratis desde el 2026-10-20)) |

**Por servicio:**

| Servicio | Variable | Valor |
| --- | --- | --- |
| relayer | `RELAYER_PRIVATE_KEY` | Clave de la wallet del relayer (en `BatchExecutor.isRelayer`) |
| liquidator | `LIQUIDATOR_PRIVATE_KEY` | Otra wallet, con ETH para gas |
| keepers | `KEEPER_PRIVATE_KEY` | Otra wallet, con ETH, también en `BatchExecutor.isRelayer` |
| indexer | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |

Las tres wallets tienen que ser distintas: cada servicio se niega a arrancar con la clave de otro.

Los nombres tienen que ser **exactos** (mayúscula y guiones bajos): con `keeper_priv_key` el servicio no la encuentra y se cae con "Falta KEEPER_PRIVATE_KEY". Al cargar una clave, guardar el valor **antes** de sellarla. Una variable sellada vacía también da "Falta…".

Formas de cargar las comunes: Shared Variables del proyecto (Project Settings → Shared Variables) y, en cada servicio, referencias `NETWORK=${{shared.NETWORK}}` desde el Raw Editor. Los cambios de variables se aplican recién al tocar **Deploy** en el cartel "Apply changes".

El liquidador no necesita un RPC de archivo: arranca desde el bloque del deploy del Exchange (91274506), fijo en el código. En el primer deploy, buscarlo con `eth_getCode` histórico fallaba en Railway con "Missing or invalid parameters".

Opcionales: `LOGS_RPC_URL` (logs para liquidator e indexer; por defecto el RPC público, porque Alchemy gratis solo deja 10 bloques por `eth_getLogs`), `INDEXER_LOG_LEVEL`, y los límites y alertas de `.env.example`.

## Indexer en Postgres

Cada deploy indexa en un schema nuevo (`RAILWAY_DEPLOYMENT_ID`) y, cuando termina, mueve las vistas del schema `jacktrade` a ese deploy. Así el deploy nuevo no choca con el viejo, y la API no se corta mientras indexa. Hoy la historia entera tarda alrededor de 1 minuto. Los schemas viejos se pueden borrar con `ponder db prune`.

## Health checks

- prices e indexer: Railway espera `/health` en 200 antes de pasar el tráfico al deploy nuevo.
- relayer, liquidator y keepers no tienen health check de deploy: su `/health` da 503 a propósito cuando algo anda mal (sin rol, poco ETH, precio atrasado), y eso no debe frenar un deploy. Se miran con las alertas (paso 20).

## Alertas por Telegram

Precios, relayer, liquidador y keepers mandan a un grupo de Telegram:

- 🔴 cuando aparece un problema de su `/health` y dura más de 1 minuto (`ALERT_AFTER_SECONDS`, default 60);
- 🟠 un recordatorio cada hora mientras siga (`ALERT_REPEAT_MINUTES`, default 60);
- 🟢 cuando se resuelve;
- 🔴 al momento si el servicio se cae o no puede arrancar.

Sin `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` no manda nada; las alertas quedan solo en el log.

### Crear el bot y el grupo

1. En Telegram, hablarle a [@BotFather](https://t.me/BotFather): `/newbot`, elegir nombre y usuario (tiene que terminar en `bot`). Te da el **token** (`123456789:AA…`). Guardarlo en Bitwarden; no pegarlo en chats.
2. Crear un **grupo** (por ejemplo "HM alertas") y agregar el bot.
3. En el grupo, mandar `/start@<usuario_del_bot>`.
4. En el navegador, abrir `https://api.telegram.org/bot<TOKEN>/getUpdates`. Buscar `"chat":{"id":-100…` del grupo: ese número (con el `-`) es el **chat id**.

### En Railway

Shared Variables:

| Variable | Valor | Seal |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | el token del bot | **Sí** |
| `TELEGRAM_CHAT_ID` | el chat id del grupo (`-100…`) | No |

Y en **prices, relayer, liquidator y keepers**, desde el Raw Editor:

```
TELEGRAM_BOT_TOKEN=${{shared.TELEGRAM_BOT_TOKEN}}
TELEGRAM_CHAT_ID=${{shared.TELEGRAM_CHAT_ID}}
```

Después, Deploy. Al arrancar, en mainnet hoy van a llegar las alertas reales (wallets sin ETH ni rol, escape hatch abierto) hasta que se resuelvan.

## Si algo se cae: respaldos y vía de escape

| Falla | Qué pasa |
| --- | --- |
| RPC principal (Alchemy) | Todos los servicios pasan solos al RPC público (`RPC_FALLBACK_URLS`, por defecto el de Robinhood Chain). El liquidador lee logs por el público y, si falla, por el principal |
| Hermes principal | Si falla 3 veces seguidas, se pasa a `HERMES_FALLBACK_URL` / `HERMES_FALLBACK_API_KEY` y cada 5 min se vuelve a probar la principal. **El Hermes público de Pyth ya no es gratis (401):** hace falta una segunda clave u otro proveedor. Sin respaldo cargado, solo la principal |
| Relayer | Los keepers consultan `RELAYER_LIVE_URL` (`/live` del relayer: loop corriendo, wallet con rol y con ETH). Si no responde 200, **no mandan heartbeat**: a las 24 h sin actividad se abre el escape hatch y los usuarios pueden cerrar solos (`closePosition`). Cuando el relayer vuelve, el heartbeat se retoma. Telegram avisa en los dos casos |
| Cualquier servicio, o Railway entero | Monitor externo (abajo): si un servicio deja de avisar "estoy vivo", alerta desde afuera |

### Monitor externo (healthchecks.io)

Cada servicio hace un GET a su `HEALTHCHECK_PING_URL` cada minuto, **solo si lo crítico anda**:

| Servicio | Avisa si… |
| --- | --- |
| prices | algún mercado tiene precio de menos de 60 s |
| relayer | el loop de batches corre |
| liquidator | lee eventos y tiene precios frescos |
| keepers | leyó la cadena hace poco |
| indexer | está listo y al día |

Configuración: cuenta gratis en healthchecks.io, un **check por servicio** (período 1 min, gracia 3 min), integración con Telegram, y la URL de ping de cada uno en `HEALTHCHECK_PING_URL` de su servicio (sellada: con ella alguien podría hacer pasar por vivo un servicio caído).

## Antes de operar en mainnet

- El owner corre `configure.ts`: mercados, feeds, y las wallets del relayer y de los keepers en `roles.relayers`.
- Sin eso, todo arranca pero no se puede operar. El relayer rechaza todo y los keepers avisan "sin rol de relayer".
- Plan de Railway: la prueba gratis no alcanza para tener todo prendido. Pasar a Hobby o Pro.

## JackTrade instance (Railway project `jacktrade`, env `production`)

Deployed with the CLI from `backend/` (`railway up . --path-as-root --service <svc> --detach`). No start command or
config file is set: `scripts/start.sh` picks the service from `RAILWAY_SERVICE_NAME` (`jt-prices`, `jt-relayer`, ...).

| Service | Public URL | Notes |
| --- | --- | --- |
| jt-prices | `https://jt-prices-production.up.railway.app` | `PORT=8080` |
| jt-relayer | `https://jt-relayer-production.up.railway.app` | `PORT=8080`, `RELAYER_MIN_ETH=0.0001` |
| jt-indexer | `https://jt-indexer-production.up.railway.app` | `PORT=8080`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `DATABASE_VIEWS_SCHEMA=jacktrade` |
| jt-keepers | none | `KEEPER_MIN_ETH=0.00005`, `RELAYER_LIVE_URL=<jt-relayer>/live`, `INDEXER_STATUS_URL=<jt-indexer>/status` |
| jt-liquidator | none | `LIQUIDATOR_MIN_ETH=0.00005` |
| Postgres | none | Indexer database |

All services: `NETWORK=mainnet`, `RPC_URL` (and `LOGS_RPC_URL` on indexer and liquidator) = public Robinhood Chain RPC,
`TRUST_PROXY=1`. `HERMES_URL` / `HERMES_API_KEY` on prices, relayer, indexer and liquidator. Private keys exist only as
Railway variables on their own service. Do not set `*_PORT` variables: they take precedence over `PORT` and the public
domain would stop routing.

To point the backend at a new deployment, replace `shared/src/generated/jacktrade.4663.ts` (addresses, ABIs, EIP-712
domains and types, markets, `deployBlock`, `libraries.PnLMath`) and redeploy every service.
