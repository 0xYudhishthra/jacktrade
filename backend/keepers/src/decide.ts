/** Decisiones de los keepers, sin cadena: se prueban solas. Tiempos en segundos, montos en unidades de USDG (6 decimales). */

export type HeartbeatInput = { now: bigint; lastActivity: bigint; escapeDelay: bigint; margin: bigint };

/**
 * Cuándo vence el escape hatch y si ya toca mandar `heartbeat`. Se manda `margin` antes del vencimiento,
 * pero como mucho a mitad del plazo: con un `escapeDelay` corto no se manda uno por chequeo.
 */
export function heartbeatPlan({ now, lastActivity, escapeDelay, margin }: HeartbeatInput) {
  const opensAt = lastActivity + escapeDelay; // desde acá (exclusivo) se puede cerrar directo
  const lead = margin < escapeDelay / 2n ? margin : escapeDelay / 2n;
  return { opensAt, sendAt: opensAt - lead, remaining: opensAt - now, due: now >= opensAt - lead, open: now > opensAt };
}

export type StakerFeesInput = {
  accrued: bigint; // stakerFeeAccrued
  queueEmpty: boolean;
  trackedLp: bigint;
  cap: bigint; // limits().stakerRewardCap
  lpCash: bigint;
  minPush: bigint; // USDG
  lastPushAt?: number; // ms
  maxIntervalMs: number;
  nowMs: number;
};

/**
 * Cuánto mandaría `pushStakerFees` y si conviene ahora. Va a staking lo acumulado de fees y, si no hay fila,
 * la caja de la casa por encima de `stakerRewardCap` (como mucho `lpCash`), igual que el contrato.
 * Se manda cuando llega a `minPush` o, si hay algo, una vez cada `maxIntervalMs`: así no se gasta gas por centavos.
 */
export function stakerFeesPlan({ accrued, queueEmpty, trackedLp, cap, lpCash, minPush, lastPushAt, maxIntervalMs, nowMs }: StakerFeesInput) {
  let excess = queueEmpty && trackedLp > cap ? trackedLp - cap : 0n;
  if (excess > lpCash) excess = lpCash;
  const total = accrued + excess;
  const overdue = lastPushAt === undefined || nowMs - lastPushAt >= maxIntervalMs;
  return { accrued, excess, total, due: total > 0n && (total >= minPush || overdue) };
}

export type HarvestInput = { head: bigint; tail: bigint; sideBucket: bigint; lpCash: bigint; nextOwed: bigint; minPay: bigint };

/**
 * Si conviene llamar a `harvest`: hay fila y caja para pagar al menos la próxima entrada entera o `minPay`.
 * Sin ese mínimo, cada pérdida chica dispararía un pago parcial que cuesta más gas de lo que mueve.
 */
export function harvestDue({ head, tail, sideBucket, lpCash, nextOwed, minPay }: HarvestInput) {
  if (head >= tail) return false;
  const available = sideBucket + lpCash;
  return available > 0n && available >= (nextOwed < minPay ? nextOwed : minPay);
}
