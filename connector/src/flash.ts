import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.ts";
import { BetError } from "./trading.ts";
import { robinhood } from "./pointsSync.ts";
import type { Bet, User } from "./db.ts";

// Grok places Definitive Flash orders itself, from its own trading wallet (the user's agent key,
// which is also a plain EOA). The user funds that wallet with a little USDG and ETH for gas;
// every order is capped by the user's max bet, and funds can only ever go back to the user's
// own wallet.

export const TOKENS = {
  USDG: { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
  TSLA: { address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", decimals: 18 },
  NVDA: { address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", decimals: 18 },
  WETH: { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", decimals: 18 },
} as const;
export type Asset = keyof typeof TOKENS;

const pub = createPublicClient({ chain: robinhood, transport: http(config.rpcUrl) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nonEmpty = (v: unknown) => v !== null && v !== undefined && v !== "";

async function flashApi(path: string, body?: unknown): Promise<any> {
  if (!config.flashApiKey) throw new BetError("Definitive Flash is not configured on this server.");
  const res = await fetch(`${config.flashUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "x-definitive-api-key": config.flashApiKey, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new BetError(`Flash: ${json?.error?.message ?? json?.message ?? `HTTP ${res.status}`}`);
  return json;
}

function account(agentKey: Hex) {
  return privateKeyToAccount(agentKey);
}

async function signJson(agentKey: Hex, typedDataJson: string) {
  const parsed = JSON.parse(typedDataJson);
  const types = { ...(parsed.types || {}) };
  delete types.EIP712Domain;
  const domain = { ...parsed.domain };
  if (domain.chainId !== undefined) domain.chainId = Number(domain.chainId);
  return account(agentKey).signTypedData({ domain, types, primaryType: parsed.primaryType, message: parsed.message });
}

async function sendTx(agentKey: Hex, tx: { to: Hex; data: Hex; value?: string }) {
  const wallet = createWalletClient({ account: account(agentKey), chain: robinhood, transport: http(config.rpcUrl) });
  const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new BetError(`Approval transaction failed: ${hash}`);
  return hash;
}

export async function walletBalances(address: string) {
  const out: Record<string, number> = {
    ETH: Number(formatUnits(await pub.getBalance({ address: address as Hex }), 18)),
  };
  for (const [sym, t] of Object.entries(TOKENS)) {
    const bal = await pub.readContract({ address: t.address as Hex, abi: erc20Abi, functionName: "balanceOf", args: [address as Hex] });
    out[sym] = Number(formatUnits(bal, t.decimals));
  }
  return out;
}

/** Which real token mirrors a bet's market. */
export function targetFor(market: string): Asset {
  const sym = market.split("/")[0].toUpperCase();
  if (sym === "TSLA" || sym === "NVDA") return sym;
  if (sym === "ETH") return "WETH";
  return "TSLA";
}

export type RealOrderInput = {
  target: Asset;
  amountUsd: number;
  side: "long" | "short";
  /** Distance used for the bracket (long) or the limit (short), as a fraction, e.g. 0.02. */
  distance: number;
};

/** Distance a bet would be liquidated at, clamped to a sensible bracket width (0.5% to 20%). */
export function distanceFromBet(bet: Pick<Bet, "leverage">): number {
  return Math.min(Math.max(1 / bet.leverage, 0.005), 0.2);
}

export async function placeRealOrder(input: RealOrderInput, user: User, agentKey: Hex) {
  if (input.target === "USDG") throw new BetError("Pick a token to buy: TSLA, NVDA or WETH.");
  if (!(input.amountUsd > 0)) throw new BetError("Amount must be positive.");
  if (input.amountUsd > user.caps.maxMarginUsd) {
    throw new BetError(`Your limit is $${user.caps.maxMarginUsd} per order. Change it on the Grok page.`);
  }
  const me = account(agentKey).address;
  const bal = await walletBalances(me);
  if (bal.USDG < input.amountUsd) {
    throw new BetError(
      `Grok's trading wallet ${me} has ${bal.USDG.toFixed(2)} USDG. Send it at least ${input.amountUsd} USDG (and a little ETH for gas) on Robinhood Chain.`,
    );
  }
  if (bal.ETH < 0.00001) throw new BetError(`Grok's trading wallet ${me} needs a little ETH on Robinhood Chain for gas (0.0001 is plenty).`);

  const target = TOKENS[input.target];
  const qty = String(input.amountUsd);
  const base: Record<string, unknown> = {
    targetChain: "robinhood",
    contraChain: "robinhood",
    targetAsset: target.address,
    contraAsset: TOKENS.USDG.address,
    side: "buy",
    qty,
    orderType: "market",
    funderAddress: me,
  };
  const probe = await flashApi("/quote", base);
  const price = Number(qty) / Number(probe.to.amount);
  const fmt = (n: number) => n.toFixed(price >= 100 ? 2 : 4);

  let body: Record<string, unknown>;
  let plan: Record<string, string>;
  if (input.side === "long") {
    const tp = fmt(price * (1 + 2 * input.distance));
    const sl = fmt(price * (1 - input.distance));
    body = { ...base, attachedBracket: { takeProfit: { notionalPrice: tp }, stopLoss: { notionalPrice: sl } } };
    plan = { type: "market buy + take-profit / stop-loss", takeProfit: tp, stopLoss: sl };
  } else {
    const limit = fmt(price * (1 - input.distance));
    body = { ...base, orderType: "limit", limitNotionalPrice: limit };
    plan = { type: "limit buy", limitPrice: limit };
  }

  let q = await flashApi("/quote", body);
  const approvals: string[] = [];
  if (q.evm?.approveTx) approvals.push(await sendTx(agentKey, q.evm.approveTx));
  if (q.attachedBracket?.evm?.approveTx) approvals.push(await sendTx(agentKey, q.attachedBracket.evm.approveTx));
  if (approvals.length) {
    await sleep(2500);
    q = await flashApi("/quote", body);
  }
  if (input.side === "long" && !nonEmpty(q.attachedBracket?.evm?.orderTypedData)) {
    throw new BetError("Flash didn't return the take-profit / stop-loss payload, so no unprotected order was placed.");
  }

  const order: Record<string, unknown> = {
    ...body,
    targetAsset: q.targetAsset || body.targetAsset,
    contraAsset: q.contraAsset || body.contraAsset,
    quoteId: q.quoteId,
    userSignature: await signJson(agentKey, q.evm.orderTypedData),
    evmOrderTypedData: q.evm.orderTypedData,
  };
  if (nonEmpty(q.evm.permitTypedData)) {
    order.evmPermitTypedData = q.evm.permitTypedData;
    order.evmPermitSignature = await signJson(agentKey, q.evm.permitTypedData);
  }
  if (input.side === "long") {
    const b = q.attachedBracket;
    order.attachedBracket = {
      ...(body.attachedBracket as object),
      userSignature: await signJson(agentKey, b.evm.orderTypedData),
      salt: b.salt,
      deadline: b.deadline,
      signedMaxFromAmount: b.signedMaxFromAmount,
      ...(nonEmpty(b.evm.permitTypedData)
        ? { evmPermitTypedData: b.evm.permitTypedData, evmPermitSignature: await signJson(agentKey, b.evm.permitTypedData) }
        : {}),
    };
  }
  const placed = await flashApi("/order", order);

  // Give a market order a moment to fill so Grok can report the result.
  let status = "submitted";
  let fillTx: string | null = null;
  for (let i = 0; i < 8 && input.side === "long"; i++) {
    await sleep(2500);
    const d = await flashApi(`/orders/${placed.orderId}?funderAddress=${me}`).catch(() => null);
    const o = d?.order ?? d;
    status = o?.status ?? status;
    fillTx = o?.fills?.find((f: any) => f.transactionId)?.transactionId ?? fillTx;
    if (/FILLED|CANCEL|FAIL|EXPIRED/i.test(status)) break;
  }
  return {
    orderId: placed.orderId,
    status,
    bracket: placed.attachedBracket?.status ?? null,
    plan,
    spent: `${qty} USDG`,
    token: input.target,
    tokenPriceUsd: Number(fmt(price)),
    fillTransaction: fillTx,
    approvals,
    wallet: me,
  };
}

export async function listRealOrders(agentKey: Hex) {
  const me = account(agentKey).address;
  const d = await flashApi(`/orders?funderAddress=${me}`);
  const orders = (d.orders ?? d ?? []) as any[];
  return orders.slice(0, 10).map((o) => ({
    orderId: o.id ?? o.orderId,
    status: o.status,
    type: o.orderType,
    bracket: o.attachedBracket?.status ?? null,
    createdAt: o.createdAt,
  }));
}

/** Sends tokens from Grok's trading wallet back to the user's own wallet. No other recipient is possible. */
export async function sendToOwner(asset: Asset | "ETH", amount: number, user: User, agentKey: Hex) {
  if (!(amount > 0)) throw new BetError("Amount must be positive.");
  const wallet = createWalletClient({ account: account(agentKey), chain: robinhood, transport: http(config.rpcUrl) });
  const to = user.wallet as Hex;
  let hash: Hex;
  if (asset === "ETH") {
    hash = await wallet.sendTransaction({ to, value: parseUnits(String(amount), 18) });
  } else {
    const t = TOKENS[asset];
    hash = await wallet.writeContract({ address: t.address as Hex, abi: erc20Abi, functionName: "transfer", args: [to, parseUnits(String(amount), t.decimals)] });
  }
  await pub.waitForTransactionReceipt({ hash });
  return { sent: `${amount} ${asset}`, to, transaction: hash };
}
