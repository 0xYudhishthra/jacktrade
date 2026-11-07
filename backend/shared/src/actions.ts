import { getAddress, isAddress, recoverTypedDataAddress, type Address, type Hex, type TypedDataDefinition } from "viem";

import { deployment } from "./network.js";

/**
 * Acciones que el usuario firma con su **wallet** (EIP-712) y el relayer manda por él, pagando el gas.
 * A diferencia de abrir y cerrar, ninguna acepta session keys: los contratos validan la firma contra `user`
 * (`SignatureChecker`: ecrecover o ERC-1271 si la wallet tiene código).
 *
 * - withdraw:           Exchange.withdrawBySig. Comparte los nonces con abrir y cerrar.
 * - registerSessionKey: SessionKeyManager.registerSessionKeyBySig (sin popup de transacción, solo una firma).
 * - stake / unstake / claim: JackTradeStaking.*BySig. Stake no necesita approve (el token le da permiso al staking).
 * - depositPermit:      Exchange.depositWithPermit con un permit EIP-2612 de USDG (sin approve previo).
 */
export type WithdrawAction = { user: Address; to: Address; amount: bigint; nonce: bigint; deadline: bigint };
/** `epoch` = `SessionKeyManager.epochOf(user)` al firmar: `revokeAllSessionKeys` lo sube e invalida la firma. */
export type RegisterSessionKeyAction = { user: Address; key: Address; expiry: bigint; epoch: bigint; nonce: bigint; deadline: bigint };
export type StakeAction = { user: Address; amount: bigint; nonce: bigint; deadline: bigint };
export type ClaimAction = { user: Address; nonce: bigint; deadline: bigint };
/** `nonce` es el de USDG (`nonces(user)`), no el del Exchange. El permit es para el Exchange (spender). */
export type DepositPermitAction = { user: Address; amount: bigint; nonce: bigint; deadline: bigint };

export type Action =
  | { kind: "withdraw"; action: WithdrawAction }
  | { kind: "registerSessionKey"; action: RegisterSessionKeyAction }
  | { kind: "stake"; action: StakeAction }
  | { kind: "unstake"; action: StakeAction }
  | { kind: "claim"; action: ClaimAction }
  | { kind: "depositPermit"; action: DepositPermitAction };

export type ActionKind = Action["kind"];
export const ACTION_KINDS: readonly ActionKind[] = ["withdraw", "registerSessionKey", "stake", "unstake", "claim", "depositPermit"];

const { eip712 } = deployment;

/** Permit de USDG (Paxos "Global Dollar"). La versión "1" sale de comparar su DOMAIN_SEPARATOR en mainnet. */
export const USDG_PERMIT_DOMAIN = {
  name: "Global Dollar",
  version: "1",
  chainId: deployment.chainId,
  verifyingContract: deployment.collateral.address as Address,
} as const;
const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Lo que se pasa a `signTypedData` de la wallet para firmar la acción. */
export function actionTypedData(a: Action): TypedDataDefinition {
  switch (a.kind) {
    case "withdraw":
      return { domain: eip712.exchange.domain, types: { Withdraw: eip712.exchange.types.Withdraw }, primaryType: "Withdraw", message: a.action };
    case "registerSessionKey":
      return {
        domain: eip712.sessionKeys.domain,
        types: { RegisterSessionKey: eip712.sessionKeys.types.RegisterSessionKey },
        primaryType: "RegisterSessionKey",
        message: a.action,
      };
    case "stake":
      return { domain: eip712.staking.domain, types: { Stake: eip712.staking.types.Stake }, primaryType: "Stake", message: a.action };
    case "unstake":
      return { domain: eip712.staking.domain, types: { Unstake: eip712.staking.types.Unstake }, primaryType: "Unstake", message: a.action };
    case "claim":
      return { domain: eip712.staking.domain, types: { Claim: eip712.staking.types.Claim }, primaryType: "Claim", message: a.action };
    case "depositPermit":
      return {
        domain: USDG_PERMIT_DOMAIN,
        types: PERMIT_TYPES,
        primaryType: "Permit",
        message: { owner: a.action.user, spender: deployment.contracts.Exchange.address, value: a.action.amount, nonce: a.action.nonce, deadline: a.action.deadline },
      };
  }
}

export function recoverActionSigner(a: Action, signature: Hex) {
  return recoverTypedDataAddress({ ...actionTypedData(a), signature });
}

/** Id de una acción en el relayer: `${kind}:${user}:${nonce}`, todo en minúsculas (`GET /action/:id` no distingue). */
export function actionId(a: Action) {
  return `${a.kind}:${a.action.user}:${a.action.nonce}`.toLowerCase();
}

// ---------------------------------------------------------------- JSON (HTTP)

type Jsonify<T> = { [K in keyof T]: T[K] extends bigint ? string : T[K] };
export type ActionJson = { [K in Action as K["kind"]]: { kind: K["kind"]; action: Jsonify<K["action"]> } }[ActionKind];

const FIELDS: Record<ActionKind, readonly string[]> = {
  withdraw: ["user", "to", "amount", "nonce", "deadline"],
  registerSessionKey: ["user", "key", "expiry", "epoch", "nonce", "deadline"],
  stake: ["user", "amount", "nonce", "deadline"],
  unstake: ["user", "amount", "nonce", "deadline"],
  claim: ["user", "nonce", "deadline"],
  depositPermit: ["user", "amount", "nonce", "deadline"],
};
const ADDRESS_FIELDS = new Set(["user", "to", "key"]);
const MAX_UINT256 = 2n ** 256n - 1n;
const MAX_UINT64 = 2n ** 64n - 1n;

export function actionToJson(a: Action): ActionJson {
  return { kind: a.kind, action: Object.fromEntries(Object.entries(a.action).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])) } as ActionJson;
}

/** Valida tipo y rango de cada campo (viene de un cliente no confiable). Las reglas de negocio las chequea el relayer. */
export function actionFromJson(json: ActionJson): Action {
  if (json === null || typeof json !== "object" || !ACTION_KINDS.includes(json.kind)) throw new Error(`kind must be one of: ${ACTION_KINDS.join(", ")}`);
  const raw = json.action as Record<string, unknown> | null;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("action must be an object");
  const keys = FIELDS[json.kind];
  if (Object.keys(raw).length !== keys.length || !keys.every((k) => Object.hasOwn(raw, k))) {
    throw new Error(`invalid ${json.kind} action: expected the fields ${keys.join(", ")}`);
  }
  const action: Record<string, unknown> = {};
  for (const k of keys) {
    const v = raw[k];
    if (ADDRESS_FIELDS.has(k)) {
      if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new Error(`${k} must be an address`);
      action[k] = getAddress(v);
    } else {
      if (typeof v !== "string" || !/^\d{1,78}$/.test(v)) throw new Error(`${k} must be an integer string`);
      const n = BigInt(v);
      if (n > (k === "expiry" || k === "epoch" ? MAX_UINT64 : MAX_UINT256)) throw new Error(`${k} out of range`);
      action[k] = n;
    }
  }
  return { kind: json.kind, action } as Action;
}
