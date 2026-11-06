import type { Address, Hex } from "viem";

import type { ActionJson } from "./actions.js";
import type { IntentJson } from "./intents.js";

/**
 * API HTTP del relayer. La usan el front y los tests.
 *
 *   POST /intent        manda un intent firmado → IntentAccepted (202) o IntentRejected (400/429)
 *   GET  /intent/:id    estado de un intent ya aceptado → IntentStatus
 *   POST /action        manda una acción firmada con la wallet (retiro, session key, staking, depósito con permit)
 *                       → ActionAccepted (202) o IntentRejected (400/429)
 *   GET  /action/:id    estado de una acción → ActionStatus
 */

export type SubmitIntentRequest = IntentJson & {
  signature: Hex;
};

/** Pasó la validación previa y entró a la fila del próximo batch. */
export type IntentAccepted = {
  id: string; // `${user}:${nonce}` en minúsculas
  status: "queued";
};

/** Rechazado antes de gastar gas. `code` es estable para que el front muestre su propio mensaje. */
export type IntentRejected = {
  status: "rejected";
  code: RejectCode;
  message: string; // en castellano, para logs y debug
};

export type IntentStatus =
  | { id: string; status: "queued" }
  | { id: string; status: "submitted"; txHash: Hex }
  // positionId: en un open, la posición nueva; en un close, la que se cerró. price: entrada o salida real (WAD).
  | { id: string; status: "executed"; txHash: Hex; positionId?: string; price: string; publishTime: number }
  | { id: string; status: "failed"; txHash?: Hex; code: RejectCode; message: string };

export type SubmitActionRequest = ActionJson & {
  signature: Hex;
};

export type ActionAccepted = {
  id: string; // `${kind}:${user}:${nonce}` todo en minúsculas (ej. depositpermit:0xabc…:3)
  status: "queued";
};

export type ActionStatus =
  | { id: string; status: "queued" }
  | { id: string; status: "submitted"; txHash: Hex }
  | { id: string; status: "executed"; txHash: Hex }
  | { id: string; status: "failed"; txHash?: Hex; code: RejectCode; message: string };

/**
 * Motivos de rechazo. Los que tienen nombre de error del contrato significan lo mismo que ese error;
 * el relayer los detecta antes (validación previa o simulación) o los decodifica de `CallFailed`.
 */
export type RejectCode =
  // formato y firma
  | "BadRequest"
  | "InvalidSignature" // ni la wallet ni una session key válida
  | "NonceAlreadyUsed"
  | "IntentExpired" // signedAt en el futuro o más viejo que intentTtl
  | "TooOld" // más viejo que el máximo del relayer (unos segundos), aunque el contrato lo aceptaría
  // mercado y tamaño
  | "TradingIsPaused"
  | "MarketNotListed"
  | "MarketIsRetired"
  | "InvalidLeverage"
  | "InvalidSize"
  | "InsufficientBalance"
  | "OiCapExceeded"
  // precio
  | "NoPrice" // no llegó un precio de Pyth posterior a signedAt a tiempo
  | "PriceTooOld" // el precio usado es anterior a signedAt (no debería pasar: el relayer espera uno posterior)
  | "PriceUncertain" // confianza de Pyth por encima de maxConfBps
  | "PriceJump"
  | "PriceLimitExceeded"
  // cierre
  | "PositionNotFound"
  | "NotPositionOwner"
  | "PositionLiquidatable" // pasó el disparo: la cierra el liquidador
  // acciones (retiro, session key, staking, depósito)
  | "SignatureExpired" // pasó el deadline, o vence antes de que el relayer llegue a mandarla
  | "BelowMinimum" // retiro o depósito por debajo del mínimo
  | "InvalidKey" // session key en cero o igual a la wallet
  | "InvalidExpiry" // vencimiento de la session key en el pasado o a más de MAX_DURATION
  | "StaleEpoch" // RegisterSessionKey firmado con un epoch viejo (hubo revokeAllSessionKeys)
  | "InsufficientStake"
  | "NothingToClaim"
  | "ZeroAmount"
  | "NotActivated" // la wallet nunca depositó: no se le pagan session keys ni staking
  // relayer
  | "RateLimited"
  | "Unknown";

/** Cómo arma el id de un intent el relayer. */
export function intentId(user: Address, nonce: bigint | string) {
  return `${user.toLowerCase()}:${nonce}`;
}
