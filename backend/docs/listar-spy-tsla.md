# Listar SPY y TSLA en el Exchange

Para Lean. Back y front ya están listos: en cuanto los mercados queden listados y se corra `pnpm sync:exports` en el
backend, se operan solos.

## Qué hay que hacer

1. Agregar los dos mercados en `scripts/config.ts` (snippet abajo).
2. Correr `configure.ts` en 4663. Es idempotente: solo hace `oracle.setFeed` y `exchange.listMarket` de los mercados
   nuevos.
3. Exportar los ABIs/deployment (`exports/`) y avisar, así corremos `pnpm sync:exports` en el backend.

## IDs y feeds

Los IDs son **100 y 101**: el back y el front ya usan esos. Que no sean 2 y 3 no importa, porque el contrato acepta
cualquier `uint32`.

| id  | mercado  | feed de Pyth (Core)                                                    | símbolo              |
| --- | -------- | ---------------------------------------------------------------------- | -------------------- |
| 100 | SPY/USD  | `0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5` | `Equity.US.SPY/USD`  |
| 101 | TSLA/USD | `0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1` | `Equity.US.TSLA/USD` |

Verificado el 2026-10-29: nuestra clave de Hermes lee los dos feeds y el update firmado que devuelve es el mismo
formato que el de BTC/ETH (sirve para `updatePrices`).

## Snippet para `scripts/config.ts`

```ts
const PYTH_SPY_USD = "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5";
const PYTH_TSLA_USD = "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1";

// en `markets`, después de ETH:
{
  id: 100,
  name: "SPY/USD",
  pythId: PYTH_SPY_USD,
  maxAge: 15,
  config: {
    maxLeverage: 1000, // ← a definir (ver abajo)
    liqBufferBps: 5,
    maxConfBps: 20,
    maxPriceJumpBps: 0,
    maxNotional: 100_000n * USD,
    impact: impact(/* positionMultiplier de SPY */),
  },
  risk: betaRisk,
},
{
  id: 101,
  name: "TSLA/USD",
  pythId: PYTH_TSLA_USD,
  maxAge: 15,
  config: {
    maxLeverage: 1000, // ← a definir (ver abajo)
    liqBufferBps: 5,
    maxConfBps: 20,
    maxPriceJumpBps: 0,
    maxNotional: 100_000n * USD,
    impact: impact(/* positionMultiplier de TSLA */),
  },
  risk: betaRisk,
},
```

## Lo que tiene que decidir él

- **`positionMultiplier` del impact.** BTC usa 814.598 y ETH 483.979, sacados de los parámetros de Papertrade. Para SPY
  y TSLA hay que calcularlos igual.
- **`maxLeverage`.** Fuera de horario Pyth no publica y el precio puede abrir con un gap. Puse 1000× para que coincida
  con cripto, pero conviene pensar uno más bajo, sobre todo para TSLA.
- **Horario.** Fuera de horario (y fines de semana), `getPriceNoOlderThan` revierte por `maxAge`. Eso significa:
  - no se abre ni se cierra;
  - **tampoco se liquida** hasta la apertura;
  - las posiciones abiertas de noche pasan el gap de apertura enteras (el margen es aislado, así que la pérdida del
    trader se limita a su margen).

  Si se quiere otra cosa (bloquear aperturas cerca del cierre, por ejemplo), es del lado del contrato.

## Qué ya está hecho de nuestro lado

- **Precios.** Las acciones van en un stream de Hermes aparte, así que si se pierde el acceso a un feed de acciones
  BTC/ETH siguen andando. Además, el último precio se pide por REST cada minuto, así que un proceso que arranca de noche
  igual tiene precio.
- **Relayer y liquidador.** No alertan "precio atrasado" de SPY/TSLA fuera de horario. Una orden fuera de horario falla
  con `NoPrice` (espera un precio posterior a la firma).
- **Front.**
  - Un mercado se habilita para operar cuando el protocolo dice `listed`; mientras no, se ve como preview.
  - Fuera de horario muestra "Market closed" y no deja abrir.
