import { concat, decodeAbiParameters, encodeAbiParameters, parseAbiParameters, type Hex, type PublicClient } from "viem";

import { deployment } from "./network.js";

/**
 * PnL de un cierre con la misma cuenta que el Exchange: se llama a `PnLMath.settle` desplegado (zona muerta, impacto
 * y redondeos incluidos), en vez de copiar la fórmula. La dirección de la librería sale del config generado (libraries.PnLMath).
 * En una librería, el selector de una función con struct no sale de la firma con tupla: `settle` está en 0x422443f3
 * (sacado del bytecode desplegado).
 */
export const PNLMATH_ADDRESS: Hex = deployment.libraries.PnLMath as Hex;
const SETTLE_SELECTOR: Hex = "0x422443f3";
const BPS = 10_000n;

export type Impact = { baseRate: bigint; rateMultiplier: bigint; positionMultiplier: bigint; referenceNotional: bigint };

export type SettleInput = {
  margin: bigint;
  leverage: bigint;
  entryPrice: bigint; // WAD
  exitPrice: bigint; // WAD
  isLong: boolean;
  deadbandDivisor: bigint; // limits().deadbandDivisor
  impact: Impact; // marketConfig(id).impact
};

/** Ganancia bruta o pérdida (USDG, 6 decimales) de cerrar a `exitPrice`. Una de las dos es 0. */
export async function settle(client: Pick<PublicClient, "call">, i: SettleInput): Promise<{ gain: bigint; loss: bigint }> {
  const { data } = await client.call({
    to: PNLMATH_ADDRESS,
    data: concat([
      SETTLE_SELECTOR,
      encodeAbiParameters(parseAbiParameters("uint256, uint256, uint256, uint256, bool, uint256, (uint256, uint256, uint256, uint256)"), [
        i.margin,
        i.leverage,
        i.entryPrice,
        i.exitPrice,
        i.isLong,
        i.deadbandDivisor,
        [i.impact.baseRate, i.impact.rateMultiplier, i.impact.positionMultiplier, i.impact.referenceNotional],
      ]),
    ]),
  });
  if (!data) throw new Error("PnLMath.settle no devolvió nada");
  const [gain, loss] = decodeAbiParameters(parseAbiParameters("uint256 gain, uint256 loss"), data);
  return { gain, loss };
}

export type PayoutInput = {
  margin: bigint;
  gain: bigint;
  loss: bigint;
  fees: { winFeeBps: number; lossFeeBps: number };
  queueEmpty: boolean; // queueHead == queueTail
  lpCash: bigint;
};

/**
 * Qué pasa con la plata si se cierra, igual que `Exchange._close` → `_payWin` / `_settleLoss`:
 * - Gana: la fee sale de la ganancia. Con la fila vacía se paga de `lpCash` y lo que no alcanza va a la fila;
 *   con fila, todo a la fila (los que esperan cobran primero).
 * - Pierde: la fee es parte de la pérdida y no se cobra mientras hay fila.
 * `returned` es lo que vuelve al balance libre ya (margen − pérdida + ganancia pagada).
 */
export function payout({ margin, gain, loss, fees, queueEmpty, lpCash }: PayoutInput) {
  if (gain > 0n) {
    const fee = (gain * BigInt(fees.winFeeBps)) / BPS;
    const net = gain - fee;
    const paidNow = queueEmpty ? (net < lpCash ? net : lpCash) : 0n;
    return { fee, payout: net, paidNow, queued: net - paidNow, returned: margin + paidNow };
  }
  const fee = queueEmpty ? (loss * BigInt(fees.lossFeeBps)) / BPS : 0n;
  return { fee, payout: 0n, paidNow: 0n, queued: 0n, returned: margin - loss };
}
