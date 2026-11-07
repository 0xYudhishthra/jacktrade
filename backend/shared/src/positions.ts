import type { Address } from "viem";

/**
 * Posición abierta tal como la necesitan el liquidador y el indexer. Se arma con `PositionOpened`.
 * Igual que `Exchange.Position` en main: no guarda buffer propio.
 */
export type Position = {
  id: bigint;
  user: Address;
  instrumentId: number;
  isLong: boolean;
  margin: bigint; // colateral, 6 decimales
  leverage: bigint;
  entryPrice: bigint; // WAD
};

/** Lo que hace falta para saber dónde se liquida una posición. */
export type LiquidationInput = Pick<Position, "entryPrice" | "leverage" | "isLong">;

const BPS = 10_000n;
const WAD_DECIMALS = 18;

/** Precio de Pyth a WAD, igual que `PriceOracle._toWad`. */
export function pythToWad(value: bigint, expo: number): bigint {
  if (expo > 0 || expo < -WAD_DECIMALS) throw new Error(`Exponente no soportado: ${expo}`);
  return value * 10n ** BigInt(WAD_DECIMALS + expo);
}

/** Distancia entre la entrada y el disparo de liquidación, igual que `PnLMath._liquidationDistance`. */
export function liquidationDistance(entryPrice: bigint, leverage: bigint, bufferBps: bigint): bigint {
  const zeroEquity = entryPrice / leverage;
  const buffer = (entryPrice * bufferBps + BPS - 1n) / BPS; // redondeo hacia arriba, como Math.Rounding.Ceil
  return zeroEquity > buffer ? zeroEquity - buffer : 0n;
}

/**
 * Precio (WAD) en el que la posición se vuelve liquidable.
 * Long: liquidable si precio <= liquidationPrice. Short: liquidable si precio >= liquidationPrice.
 *
 * `bufferBps` es el `liqBufferBps` **actual** del mercado (`marketConfig`): en main el contrato no lo guarda
 * en la posición. Mientras no cambie la config, el precio es fijo y el liquidador puede ordenar por él;
 * si llega un `MarketConfigSet`, hay que recalcular las posiciones de ese mercado.
 */
export function liquidationPrice(p: LiquidationInput, bufferBps: number): bigint {
  const dist = liquidationDistance(p.entryPrice, p.leverage, BigInt(bufferBps));
  return p.isLong ? p.entryPrice - dist : p.entryPrice + dist;
}

/** Igual que `PnLMath.isLiquidatable(entryPrice, leverage, bufferBps, isLong, price)`. */
export function isLiquidatable(p: LiquidationInput, bufferBps: number, price: bigint) {
  const liq = liquidationPrice(p, bufferBps);
  return p.isLong ? price <= liq : price >= liq;
}
