# JackTrade: integración de los contratos con el backend

Actualizado el 20/10/2026. Robinhood Chain (chain id 4663), una cadena Arbitrum Orbit.

## Qué usa el backend

Todo el backend está hecho contra **`main` de contracts (`d287db6`)**, lo desplegado. El backend está en producción (Railway) y **no puede operar** hasta que se configure mainnet.

| Contrato | Dirección |
| --- | --- |
| Exchange | `0xc8d93fed32729578c4a65f95bb32a353baa93f56` |
| BatchExecutor | `0xe24cadad16f9a38f53e4bc652714e10cbfd747ae` |
| SessionKeyManager | `0xdb4b767bfa81c4c02d50b3eac5f6869241bc57bc` |
| JackTradeStaking | `0x1b261e27978c385ed879ea1c2a0d20da1a0338a6` |
| PriceOracle | `0xc4b562cab2ed45fc168824b6af9e2bbd6eff8b29` |
| Pyth | `0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a` |
| PnLMath (librería) | `0x448033aa4bdef5df3156e17b445845b8dde82857` (`settle` = `0x422443f3`) |
| USDG (colateral) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |

**Wallets del backend:**

| Wallet | Dirección | Rol que necesita |
| --- | --- | --- |
| Relayer | `0x5E0eCA922BfC678B4Cc73F016eefF4f0b9d5cAFb` | `BatchExecutor.isRelayer` |
| Keepers | `0xC9f85aea7A07a7eaA9ef351212bec54b1Bb31f86` | `BatchExecutor.isRelayer` (para `heartbeat`) |
| Liquidador | `0x34e772662f795d5504F35F320AC9f30e52DD7Bb4` | Ninguno: `liquidate` es pública |

## 1. Configuración que falta en mainnet (bloqueante)

> Hoy mainnet **no tiene ningún mercado listado**. Nada se puede operar hasta correr `configure.ts`.

1. **Mercados y feeds:** BTC/USD (id 0) y ETH/USD (id 1).
2. **Relayers**, en `scripts/config.ts`, config de `4663`:
   ```ts
   roles: {
     relayers: [
       "0x5E0eCA922BfC678B4Cc73F016eefF4f0b9d5cAFb", // relayer (backend)
       "0xC9f85aea7A07a7eaA9ef351212bec54b1Bb31f86", // keepers: heartbeat va por BatchExecutor
     ],
   },
   ```
3. **Subir `maxConfBps`:** con 10 bps se rechazan demasiadas órdenes por confianza de Pyth. Ver contracts#2.
4. Correr `configure.ts` en mainnet y avisar al backend.

**Parámetros hoy en la cadena:**
- Fees: 2% en ganancia, pérdida y liquidación.
- `intentTtl`: 1 h. `escapeDelay`: 24 h.
- Depósito y retiro mínimos: 10 USDG. Activación: 1 USDG.
- `stakerRewardCap`: 5.000.000 USDG.

## 2. Pedidos al equipo de contratos

| Qué | Por qué | Prioridad |
| --- | --- | --- |
| **Owner en multisig** | Hoy el owner, el `guardian`, el `marketKeeper` y el `devFeeRecipient` son la **misma EOA** (`0x1a18679aaef479820e3d0cAf070a42c4d778AE62`) | Antes de que haya plata real |
| **Tope de gas por llamada en `BatchExecutor.execute`** (`target.call{gas: cap}(...)`) | Una wallet que delega por EIP-7702 a un contrato puede quemar el gas de un batch ajeno durante la verificación de firma (ERC-1271). El backend lo mitiga (revisa el código antes de simular y aísla esas wallets); el tope lo cierra | Alta |
| **Caja de la casa** | `lpCash` arranca en 0 y solo crece con las pérdidas: las primeras ganancias van a la fila. ¿Se fondea al lanzar? No hay función para hacerlo | Decidir |
| **Fees siempre** (98% fila / 1% staking / 1% ganancia) | Hoy las pérdidas no pagan fee mientras hay fila | Decidir |
| **EIP-7702** | Aceptar también `ecrecover` para cuentas con código delegado, o dejarlo así (con session key funcionan) | Decidir |
| Roles `marketKeeper` y `devFeeRecipient` | Si se quiere un keeper automático de límites de OI y el cobro automático de fees de dev | Después |

## 3. Lo que no se puede cambiar sin avisar

El backend depende de estas firmas. **Si cambian, hay que actualizar el backend antes del deploy.**

**Exchange:**
- Eventos: `PositionOpened`, `PositionClosed`, `PositionLiquidated`, `MarketListed`, `MarketConfigSet`, `MarketRetired`, `Deposited`, `Withdrawn`, `PayoutQueued`, `QueuePaid`, `TokensMinted`, `TradingPausedSet`, `Heartbeat`, `StakerFeesPushed`, `StakingRewardCredited`.
- Funciones: `openPositionBySig`, `closePositionBySig`, `withdrawBySig`, `depositWithPermit`, `liquidate`, `harvest`, `heartbeat`, `pushStakerFees`.
- Vistas: `marketConfig`, `marketRisk`, `marketState`, `limits`, `fees`, `balances`, `nonceUsed`, `activated`, `lpCash`, `lpBankrollAvailable`, `trackedLp`, `sideBucket`, `stakerFeeAccrued`, `queueHead`, `queueTail`, `queue`, `queuedOf`, `totalQueued`, `lastExecutorActivity`, `positions`, `tradingPaused`.
- Tipos EIP-712: `Open`, `Close`, `Withdraw`.

**SessionKeyManager:**
- Eventos: `SessionKeyRegistered`, `SessionKeyRevoked`, `AllSessionKeysRevoked`.
- Funciones: `registerSessionKeyBySig`, `isValidSessionKey`, `nonceUsed`, `MAX_DURATION`.
- Tipo EIP-712: `RegisterSessionKey`.

**JackTradeStaking:**
- Eventos: `Staked`, `Unstaked`, `Claimed`, `RewardNotified`.
- Funciones: `stakeBySig`, `unstakeBySig`, `claimBySig`, `pendingReward`, `stakeOf`, `nonceUsed`.
- Tipos EIP-712: `Stake`, `Unstake`, `Claim`.

**BatchExecutor:** `execute`, `CallFailed`, `isRelayer`.

**PriceOracle:** `updatePrices`, `getUpdateFee`.

**JackTradeTokenomics:** `currentRate`.

**PnLMath:** `settle`, que se llama directo por su selector.

### Cómo pasar un cambio al backend

1. Mergear a `main` de contracts.
2. Pasar el **SHA completo** del commit al backend.
3. El backend corre `pnpm sync:exports` con ese commit: regenera ABIs, direcciones y tipos EIP-712, prueba en un fork y deploya.

El backend **solo** usa `main`: las branches de trabajo no las toca.

## 4. Operación y emergencias

- **Pausar aperturas:** `setTradingPaused(true)`. **Retirar un mercado:** `retireMarket(id)`, que lo cierra al precio congelado.
  - Los puede firmar el `guardian` o el owner.
  - Cerrar posiciones sigue funcionando.
- **Vía de escape:** si el relayer se cae, los keepers dejan de mandar `heartbeat`. A las 24 h sin actividad (`escapeDelay`) los usuarios pueden cerrar solos con `closePosition`.
- **Alertas:** llegan al grupo de Telegram *JackTradeAlerts* (poco ETH, precio atrasado, liquidaciones trabadas, escape hatch, caídas).
- **Pyth:** un mes gratis desde el 20/10, hasta ~19/11. Sin precios se frena todo.

## Checklist para contratos

- [ ] Agregar relayer y keepers en `roles.relayers`.
- [ ] Subir `maxConfBps`.
- [ ] Correr `configure.ts` en mainnet (mercados, feeds, relayers) y avisar.
- [ ] Owner, guardian y demás roles en multisig.
- [ ] Tope de gas por llamada en `BatchExecutor.execute`.
- [ ] Decidir: caja de la casa, fees siempre y EIP-7702.
- [ ] Avisar al backend antes de cambiar cualquier firma de la sección 3.
