import { getAddress, isAddress, recoverTypedDataAddress, type Address, type Hex, type TypedDataDefinition } from "viem";

import { deployment } from "./network.js";

/**
 * Intents que el usuario firma (EIP-712) y el relayer manda al Exchange vía BatchExecutor.
 * Los campos y el orden salen de los contratos (`Exchange.OpenIntent` / `CloseIntent`); los tipos EIP-712, del export.
 */
export type OpenIntent = {
  user: Address;
  instrumentId: number; // uint32, id del mercado
  isLong: boolean;
  margin: bigint; // unidades del colateral (USDG, 6 decimales)
  leverage: bigint;
  priceLimit: bigint; // WAD. Long: entrada máxima. Short: entrada mínima. 0 = sin límite
  signedAt: bigint; // segundos Unix. Tiene que ser <= block.timestamp y estar dentro de intentTtl
  nonce: bigint;
};

export type CloseIntent = {
  user: Address;
  positionId: bigint;
  priceLimit: bigint; // WAD. Long: salida mínima. Short: salida máxima. 0 = sin límite
  signedAt: bigint;
  nonce: bigint;
};

export type Intent = { kind: "open"; intent: OpenIntent } | { kind: "close"; intent: CloseIntent };

const { domain, types } = deployment.eip712.exchange;

/** Lo que se pasa a `signTypedData` de viem (wallet o session key) para firmar el intent. */
export function intentTypedData(i: Intent): TypedDataDefinition {
  return i.kind === "open"
    ? { domain, types: { Open: types.Open }, primaryType: "Open", message: i.intent }
    : { domain, types: { Close: types.Close }, primaryType: "Close", message: i.intent };
}

/**
 * Quién firmó el intent. Puede ser la wallet (`intent.user`) o una session key registrada para ella;
 * eso último lo valida el relayer con `SessionKeyManager.isValidSessionKey(user, signer)`.
 * No cubre wallets de contrato (ERC-1271): para esas el relayer simula la llamada.
 */
export function recoverIntentSigner(i: Intent, signature: Hex) {
  return recoverTypedDataAddress({ ...intentTypedData(i), signature });
}

// ---------------------------------------------------------------- JSON (HTTP)

/** Intent en JSON: los bigint viajan como string decimal. */
export type IntentJson =
  | { kind: "open"; intent: { [K in keyof OpenIntent]: OpenIntent[K] extends bigint ? string : OpenIntent[K] } }
  | { kind: "close"; intent: { [K in keyof CloseIntent]: CloseIntent[K] extends bigint ? string : CloseIntent[K] } };

const BIGINT_FIELDS = new Set(["margin", "leverage", "priceLimit", "signedAt", "nonce", "positionId"]);

export function intentToJson(i: Intent): IntentJson {
  const intent = Object.fromEntries(
    Object.entries(i.intent).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
  );
  return { kind: i.kind, intent } as IntentJson;
}

const MAX_UINT256 = 2n ** 256n - 1n;

/**
 * Valida tipo y rango de cada campo y tira error si algo no cumple. Viene de un cliente no confiable:
 * nada pasa sin chequear. La validación de negocio (saldo, mercado, firma) la hace el relayer después.
 */
export function intentFromJson(json: IntentJson): Intent {
  if (json === null || typeof json !== "object" || (json.kind !== "open" && json.kind !== "close")) {
    throw new Error("kind must be open or close");
  }
  const raw = json.intent as Record<string, unknown> | null;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("intent must be an object");
  const keys = (json.kind === "open" ? types.Open : types.Close).map((t) => t.name);
  if (Object.keys(raw).length !== keys.length || !keys.every((k) => Object.hasOwn(raw, k))) {
    throw new Error(`invalid ${json.kind} intent: expected the fields ${keys.join(", ")}`);
  }

  const intent: Record<string, unknown> = {};
  for (const k of keys) {
    const v = raw[k];
    if (BIGINT_FIELDS.has(k)) {
      if (typeof v !== "string" || !/^\d{1,78}$/.test(v)) throw new Error(`${k} must be an integer string`);
      const n = BigInt(v);
      if (n > MAX_UINT256) throw new Error(`${k} out of range`);
      intent[k] = n;
    } else if (k === "user") {
      if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new Error("user must be an address");
      intent[k] = getAddress(v);
    } else if (k === "instrumentId") {
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > 0xffffffff) throw new Error("instrumentId must be a uint32 integer");
      intent[k] = v;
    } else if (k === "isLong") {
      if (typeof v !== "boolean") throw new Error("isLong must be true or false");
      intent[k] = v;
    } else {
      throw new Error(`campo inesperado: ${k}`);
    }
  }
  return { kind: json.kind, intent } as Intent;
}
