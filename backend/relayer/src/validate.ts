import type { PriceStore } from "@hm/prices";
import { intentTypedData, isLiquidatable, pythToWad, recoverIntentSigner, type Intent, type RejectCode } from "@hm/shared";
import { hashTypedData, type Hex } from "viem";

import type { ChainState } from "./chain.js";

/** Exchange.MIN_LEVERAGE (constante privada en el contrato). */
const MIN_LEVERAGE = 2n;

/** Lo que ya está en la fila y todavía no se ejecutó: reserva balance, OI y nonces. */
export interface Pending {
  hasNonce(user: Hex, nonce: bigint): boolean;
  reservedMargin(user: Hex): bigint;
  reservedOi(instrumentId: number, isLong: boolean): bigint;
}

export type ValidationContext = {
  chain: ChainState;
  prices: PriceStore;
  feedIdOf: (instrumentId: number) => Hex | undefined;
  pending: Pending;
  /** Segundos máximos desde `signedAt` que acepta el relayer (más estricto que el intentTtl del contrato). */
  maxIntentAge: number;
  /** Segundos que `signedAt` puede ir por delante de la cadena (reloj del usuario un poco adelantado). */
  futureTolerance: number;
};

export class Rejected extends Error {
  constructor(
    readonly code: RejectCode,
    message: string,
  ) {
    super(message);
  }
}

const reject = (code: RejectCode, message: string): never => {
  throw new Rejected(code, message);
};

/**
 * Validación previa: mismas reglas que el Exchange, para rechazar antes de gastar gas.
 * Devuelve quién firmó (la wallet o una session key) y el mercado. Tira `Rejected` con el código si algo no cumple.
 */
export async function validateIntent(
  i: Intent,
  signature: Hex,
  ctx: ValidationContext,
  /** Firmante ya recuperado (el server lo recupera antes, para el límite por firmante). */
  recovered?: Hex,
): Promise<{ signer: Hex; instrumentId: number; walletHasCode: boolean }> {
  const { chain, pending } = ctx;
  const { user, nonce, signedAt } = i.intent;

  // Tiempo. El contrato revierte si signedAt > block.timestamp o si pasó intentTtl.
  const now = chain.now();
  const age = now - Number(signedAt);
  if (age < -ctx.futureTolerance) reject("IntentExpired", `signedAt is ${(-age).toFixed(1)} s ahead of the chain`);
  if (age > chain.intentTtl) reject("IntentExpired", `older than the intentTtl of ${chain.intentTtl} s`);
  if (age > ctx.maxIntentAge) reject("TooOld", `it is ${age.toFixed(1)} s old; the relayer accepts up to ${ctx.maxIntentAge} s`);

  // Firma, igual que el Exchange (SignatureChecker): si la wallet tiene código (contrato o delegación EIP-7702)
  // se valida por ERC-1271; si no, por ecrecover. Si eso falla, se prueba como session key.
  const signer = recovered ?? ((await recoverIntentSigner(i, signature).catch(() => reject("InvalidSignature", "unreadable signature"))) as Hex);
  const walletHasCode = await chain.hasCode(user);
  const walletOk = walletHasCode
    ? await chain.isValidErc1271(user, hashTypedData(intentTypedData(i)), signature)
    : signer.toLowerCase() === user.toLowerCase();
  if (!walletOk && !(await chain.isValidSessionKey(user, signer))) {
    reject("InvalidSignature", `signed by ${signer}: not accepted by the wallet ${user} (ERC-1271 if it has code) and not a valid session key`);
  }

  // Nonce: ni usado en la cadena ni repetido en la fila.
  if (pending.hasNonce(user, nonce) || (await chain.nonceUsed(user, nonce))) reject("NonceAlreadyUsed", `nonce ${nonce} already used`);

  if (chain.tradingPaused && i.kind === "open") reject("TradingIsPaused", "new positions are paused");

  const instrumentId = i.kind === "open" ? await validateOpen(i.intent, ctx) : await validateClose(i.intent, ctx);
  return { signer, instrumentId, walletHasCode };
}

async function validateOpen(it: Extract<Intent, { kind: "open" }>["intent"], ctx: ValidationContext) {
  const m = ctx.chain.markets.get(it.instrumentId);
  if (!m || !m.listed) reject("MarketNotListed", `market ${it.instrumentId} is not listed`);
  if (m!.retired) reject("MarketIsRetired", `market ${it.instrumentId} is retired`);
  if (it.leverage < MIN_LEVERAGE || it.leverage > m!.maxLeverage) reject("InvalidLeverage", `leverage ${it.leverage}; allowed ${MIN_LEVERAGE}..${m!.maxLeverage}`);

  const notional = it.margin * it.leverage;
  if (it.margin < m!.minMargin || notional < m!.minNotional || notional > m!.maxNotional) {
    reject("InvalidSize", `margin ${it.margin} and notional ${notional} outside [${m!.minMargin}, ${m!.minNotional}..${m!.maxNotional}]`);
  }

  const free = (await ctx.chain.balance(it.user)) - ctx.pending.reservedMargin(it.user);
  if (free < it.margin) reject("InsufficientBalance", `free balance ${free}, margin ${it.margin}`);

  const oi = (it.isLong ? m!.longOi : m!.shortOi) + ctx.pending.reservedOi(it.instrumentId, it.isLong) + notional;
  if (oi > (it.isLong ? m!.longOiCap : m!.shortOiCap)) reject("OiCapExceeded", `open interest would be ${oi}`);

  // Confianza con el último precio. El precio de ejecución es otro (posterior a signedAt), pero esto filtra lo obvio.
  const price = ctx.prices.latest(ctx.feedIdOf(it.instrumentId)!);
  if (!price) reject("NoPrice", "no Pyth price for this market yet");
  if (price!.conf * 10_000n > price!.price * BigInt(m!.maxConfBps)) {
    reject("PriceUncertain", `confidence ${((Number(price!.conf) / Number(price!.price)) * 10_000).toFixed(2)} bps > ${m!.maxConfBps}`);
  }
  return it.instrumentId;
}

async function validateClose(it: Extract<Intent, { kind: "close" }>["intent"], ctx: ValidationContext) {
  const pos = await ctx.chain.position(it.positionId);
  if (pos.owner === "0x0000000000000000000000000000000000000000") reject("PositionNotFound", `position ${it.positionId} does not exist`);
  if (pos.owner.toLowerCase() !== it.user.toLowerCase()) reject("NotPositionOwner", `the position belongs to ${pos.owner}`);

  const m = ctx.chain.markets.get(pos.instrumentId);
  const price = ctx.prices.latest(ctx.feedIdOf(pos.instrumentId)!);
  if (m && price && isLiquidatable(pos, m.liqBufferBps, pythToWad(price.price, price.expo))) {
    reject("PositionLiquidatable", "past the liquidation price: the liquidator will close it");
  }
  return pos.instrumentId;
}
