// Cliente de ejemplo para el front: session keys, firma de intents y envío al relayer.
// JavaScript con viem (`bun add viem`). Probado contra el relayer con `pnpm try:front-client` en el repo backend.
// Ver docs/intents-front.md.

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const SESSION_KEY_ABI = [
  {
    type: "function",
    name: "registerSessionKey",
    stateMutability: "nonpayable",
    inputs: [
      { name: "key", type: "address" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isValidSessionKey",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "key", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
];

// ---------------------------------------------------------------- config y hora

/**
 * Trae del relayer contratos, tipos EIP-712, mercados y la hora de la cadena.
 * `clockOffset` corrige el reloj del navegador: `signedAt` tiene que salir de la hora de la cadena.
 */
export async function loadConfig(relayerUrl) {
  const config = await (await fetch(`${relayerUrl}/config`)).json();
  return { ...config, relayerUrl, clockOffset: config.chainTime - Date.now() / 1000 };
}

/** Hora de la cadena en segundos (bigint), para `signedAt`. */
export function chainNow(config) {
  return BigInt(Math.floor(Date.now() / 1000 + config.clockOffset));
}

/** Nonce único por usuario. No hace falta que sea correlativo. */
export function newNonce() {
  return BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
}

// ---------------------------------------------------------------- session key

/**
 * Crea una session key en el navegador. Guardar `privateKey` en el dispositivo (por ejemplo localStorage),
 * nunca mandarla a ningún servidor. Solo sirve para abrir y cerrar posiciones; no puede retirar fondos.
 */
export function createSessionKey() {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

/** Cuenta de viem para firmar con una session key guardada. */
export function sessionKeyAccount(privateKey) {
  return privateKeyToAccount(privateKey);
}

/**
 * Registra la session key con una transacción de la wallet del usuario: es la única vez que aparece la wallet.
 * `walletClient` es un WalletClient de viem conectado a la wallet (por ejemplo `custom(window.ethereum)`).
 */
export async function registerSessionKey(walletClient, config, sessionKeyAddress, durationSeconds = config.limits.sessionKeyMaxDuration) {
  const seconds = Math.min(durationSeconds, config.limits.sessionKeyMaxDuration);
  const expiry = chainNow(config) + BigInt(seconds);
  return walletClient.writeContract({
    address: config.contracts.SessionKeyManager,
    abi: SESSION_KEY_ABI,
    functionName: "registerSessionKey",
    args: [sessionKeyAddress, expiry],
  });
}

/** Si la session key sigue valiendo para el usuario (no venció ni fue revocada). */
export function isValidSessionKey(publicClient, config, user, sessionKeyAddress) {
  return publicClient.readContract({
    address: config.contracts.SessionKeyManager,
    abi: SESSION_KEY_ABI,
    functionName: "isValidSessionKey",
    args: [user, sessionKeyAddress],
  });
}

// ---------------------------------------------------------------- precio

/**
 * `priceLimit` en WAD a partir del precio del websocket ({ price, expo }).
 * Long: precio máximo aceptable. Short: mínimo. Para cerrar se invierte: cerrar un long es vender.
 * slippageBps 50 = 0,5%.
 */
export function priceLimit(quote, { isLong, closing = false, slippageBps = 50 }) {
  const wad = BigInt(quote.price) * 10n ** BigInt(18 + quote.expo);
  const buying = closing ? !isLong : isLong;
  return buying ? (wad * BigInt(10_000 + slippageBps)) / 10_000n : (wad * BigInt(10_000 - slippageBps)) / 10_000n;
}

// ---------------------------------------------------------------- intents

export class RelayerError extends Error {
  constructor(code, message) {
    super(REJECT_MESSAGES[code] ?? message);
    this.code = code;
    this.detail = message;
  }
}

async function submit(config, signer, kind, intent) {
  const { domain, types } = config.eip712;
  const primaryType = kind === "open" ? "Open" : "Close";
  const signature = await signer.signTypedData({ domain, types: { [primaryType]: types[primaryType] }, primaryType, message: intent });
  const body = { kind, intent: Object.fromEntries(Object.entries(intent).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])), signature };
  const res = await (await fetch(`${config.relayerUrl}/intent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  if (res.status === "rejected") throw new RelayerError(res.code, res.message);
  return res.id;
}

/** Espera a que el intent termine. Devuelve el estado `executed` o tira RelayerError si falló. */
export async function waitForIntent(config, id, { timeoutMs = 15_000, intervalMs = 250 } = {}) {
  for (const end = Date.now() + timeoutMs; Date.now() < end; ) {
    const status = await (await fetch(`${config.relayerUrl}/intent/${id}`)).json();
    if (status.status === "executed") return status;
    if (status.status === "failed") throw new RelayerError(status.code, status.message);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new RelayerError("Timeout", "the relayer did not respond in time");
}

/**
 * Abre una posición firmando con la session key. `margin` en unidades del colateral (6 decimales).
 * Devuelve { positionId, price (WAD, string), txHash }.
 */
export async function openPosition(config, { user, signer, instrumentId, isLong, margin, leverage, quote, slippageBps }) {
  const intent = {
    user,
    instrumentId,
    isLong,
    margin: BigInt(margin),
    leverage: BigInt(leverage),
    priceLimit: quote ? priceLimit(quote, { isLong, slippageBps }) : 0n,
    signedAt: chainNow(config),
    nonce: newNonce(),
  };
  return waitForIntent(config, await submit(config, signer, "open", intent));
}

/** Cierra una posición. `isLong` es el lado de la posición (para el priceLimit). */
export async function closePosition(config, { user, signer, positionId, isLong, quote, slippageBps }) {
  const intent = {
    user,
    positionId: BigInt(positionId),
    priceLimit: quote ? priceLimit(quote, { isLong, closing: true, slippageBps }) : 0n,
    signedAt: chainNow(config),
    nonce: newNonce(),
  };
  return waitForIntent(config, await submit(config, signer, "close", intent));
}

// ---------------------------------------------------------------- mensajes

/** Texto para el usuario según el `code` del relayer. */
export const REJECT_MESSAGES = {
  BadRequest: "Invalid request.",
  InvalidSignature: "Invalid signature. Please reconnect your session.",
  NonceAlreadyUsed: "This order was already sent.",
  IntentExpired: "The order expired. Please try again.",
  TooOld: "The order took too long to arrive. Please try again.",
  TradingIsPaused: "Trading is paused.",
  MarketNotListed: "This market is not available.",
  MarketIsRetired: "This market was retired.",
  InvalidLeverage: "Leverage out of range.",
  InvalidSize: "Position size is outside the limits (minimum margin 10 USDG, minimum notional 1,000 USDG).",
  InsufficientBalance: "Insufficient balance.",
  OiCapExceeded: "Open interest limit reached on this side. Please try later.",
  NoPrice: "The price did not arrive in time. Please try again.",
  PriceTooOld: "The price is stale. Please try again.",
  PriceUncertain: "The price is too uncertain right now. Please try in a few seconds.",
  PriceJump: "The price moved too fast. Please try again.",
  PriceLimitExceeded: "The price moved beyond your slippage tolerance.",
  PositionNotFound: "This position does not exist.",
  NotPositionOwner: "This position is not yours.",
  PositionLiquidatable: "This position reached its liquidation price.",
  RateLimited: "Too many orders in a row. Please wait a moment.",
  Timeout: "The relayer did not respond in time. Check your positions.",
  Unknown: "Something went wrong. Please try again.",
};
