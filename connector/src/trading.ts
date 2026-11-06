import { privateKeyToAccount } from "viem/accounts";
import { config, txLink } from "./config.ts";
import { randomUint256 } from "./crypto.ts";
import type { Bet, Caps, Store, User } from "./db.ts";
import { pointsFor } from "./points.ts";
import * as up from "./upstream.ts";

const USD = 1_000_000n; // USDG has 6 decimals
const WAD = 10n ** 18n;
const LIQ_BUFFER_BPS = 5n; // JackTrade's live liquidation buffer
const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%

export class BetError extends Error {}

export type Side = "long" | "short";

export type QuoteInput = { market: string; side: Side; marginUsd: number; leverage: number };

export type Quote = {
  market: string;
  instrumentId: number;
  side: Side;
  marginUsd: number;
  leverage: number;
  notionalUsd: number;
  entryPrice: number;
  liquidationPrice: number;
  liquidationMovePct: number;
  marketOpen: boolean;
  houseBankrollUsd: number;
  pointsEarned: number;
  notes: string[];
};

/** "tsla", "TSLA/USD", "Tesla" → the relayer market. Lists what's available when not found. */
export async function resolveMarket(query: string): Promise<{ market: up.Market; price: up.Price | undefined }> {
  const cfg = await up.relayerConfig();
  const q = query.trim().toUpperCase().replace(/[^A-Z]/g, "");
  const aliases: Record<string, string> = { BITCOIN: "BTC", ETHER: "ETH", ETHEREUM: "ETH", TESLA: "TSLA", SP: "SPY", SPX: "SPY" };
  const symbol = aliases[q] ?? q.replace(/USD$/, "");
  const listed = cfg.markets.filter((m) => m.listed);
  const market = listed.find((m) => m.name.split("/")[0] === symbol);
  if (!market) {
    const available = listed.map((m) => m.name.split("/")[0]).join(", ");
    throw new BetError(`${symbol} is not open for betting yet. Markets open right now: ${available}.`);
  }
  const all = await up.prices();
  return { market, price: all.find((p) => p.market === market.id) };
}

function priceWad(p: up.Price): bigint {
  const raw = BigInt(p.price);
  const shift = 18 + p.expo;
  return shift >= 0 ? raw * 10n ** BigInt(shift) : raw / 10n ** BigInt(-shift);
}

export function liquidationPrice(entry: number, leverage: number, side: Side): number {
  const bufferBps = Math.min(Number(LIQ_BUFFER_BPS), (1e4 - 1) / leverage);
  const distance = entry / leverage - (entry * bufferBps) / 1e4;
  return side === "long" ? entry - distance : entry + distance;
}

function riskUsedToday(store: Store, wallet: string): number {
  const since = Math.floor(Date.now() / 1000) - 86_400;
  return store
    .betsByWallet(wallet, since)
    .filter((b) => b.status !== "failed")
    .reduce((sum, b) => sum + (b.status === "closed" && (b.pnlUsd ?? 0) >= 0 ? 0 : b.marginUsd), 0);
}

export async function quote(input: QuoteInput, caps: Caps, store: Store, wallet: string): Promise<Quote> {
  const { market, price } = await resolveMarket(input.market);
  if (!price) throw new BetError(`No live price for ${market.name} right now.`);
  const notes: string[] = [];
  const marketOpen = price.marketOpen ?? true;
  if (!marketOpen) notes.push(`${market.name} is outside market hours, so bets will be rejected until it reopens.`);

  const { marginUsd, leverage } = input;
  const notionalUsd = marginUsd * leverage;
  const minMargin = Number(BigInt(market.minMargin)) / 1e6;
  const minNotional = Number(BigInt(market.minNotional)) / 1e6;
  const maxNotional = Number(BigInt(market.maxNotional)) / 1e6;

  if (!Number.isInteger(leverage) || leverage < 2) throw new BetError("Leverage must be a whole number of at least 2.");
  if (leverage > market.maxLeverage) throw new BetError(`Max leverage on ${market.name} is ${market.maxLeverage}x.`);
  if (marginUsd < minMargin) throw new BetError(`Minimum bet on ${market.name} is $${minMargin}.`);
  if (notionalUsd < minNotional) throw new BetError(`Position size must be at least $${minNotional}.`);
  if (notionalUsd > maxNotional) throw new BetError(`Position size can't exceed $${maxNotional}.`);
  if (marginUsd > caps.maxMarginUsd) throw new BetError(`Your limit is $${caps.maxMarginUsd} per bet. Change it on the Connect page.`);
  if (leverage > caps.maxLeverage) throw new BetError(`Your leverage limit is ${caps.maxLeverage}x. Change it on the Connect page.`);
  const used = riskUsedToday(store, wallet);
  if (used + marginUsd > caps.dailyLossUsd) {
    throw new BetError(
      `That would put $${(used + marginUsd).toFixed(2)} at risk in 24h; your daily limit is $${caps.dailyLossUsd}.`,
    );
  }

  const health = await up.relayerHealth();
  const houseBankrollUsd = Number(health.lpBankrollAvailable);
  if (Number(health.totalQueued) > 0) notes.push("The house has a payout queue; wins are paid in order as the house refills.");
  notes.push(
    `The house can pay up to $${houseBankrollUsd.toFixed(2)} right now; any win above that waits in the payout queue.`,
  );
  if (leverage >= 500) notes.push("At this leverage a tiny move against you liquidates the whole bet.");

  const entryPrice = price.usd;
  const liq = liquidationPrice(entryPrice, leverage, input.side);
  return {
    market: market.name,
    instrumentId: market.id,
    side: input.side,
    marginUsd,
    leverage,
    notionalUsd,
    pointsEarned: pointsFor(notionalUsd),
    entryPrice,
    liquidationPrice: liq,
    liquidationMovePct: (Math.abs(entryPrice - liq) / entryPrice) * 100,
    marketOpen,
    houseBankrollUsd,
    notes,
  };
}

async function waitForIntent(id: string, timeoutMs = 25_000): Promise<up.IntentStatus> {
  const deadline = Date.now() + timeoutMs;
  let last: up.IntentStatus = { status: "queued" };
  while (Date.now() < deadline) {
    last = await up.intentStatus(id);
    if (last.status === "executed" || last.status === "failed") return last;
    await new Promise((r) => setTimeout(r, 600));
  }
  return last;
}

function agentAccount(user: User, agentKey: `0x${string}`) {
  const account = privateKeyToAccount(agentKey);
  if (account.address.toLowerCase() !== user.agentAddress.toLowerCase()) throw new Error("agent key mismatch");
  return account;
}

export type PlaceResult = {
  bet: Bet;
  txUrl: string | null;
  message: string;
};

export async function placeBet(
  input: QuoteInput & { maxSlippagePct?: number },
  user: User,
  agentKey: `0x${string}`,
  store: Store,
): Promise<PlaceResult> {
  const q = await quote(input, user.caps, store, user.wallet);
  if (!q.marketOpen) throw new BetError(q.notes[0]);
  const cfg = await up.relayerConfig();
  if (cfg.tradingPaused) throw new BetError("Trading on JackTrade is paused right now.");

  const { price } = await resolveMarket(input.market);
  if (!price) throw new BetError("No live price.");
  const slipBps = BigInt(Math.round((input.maxSlippagePct ?? DEFAULT_SLIPPAGE_BPS / 100) * 100));
  const mark = priceWad(price);
  const isLong = input.side === "long";
  const priceLimit = isLong ? (mark * (10_000n + slipBps)) / 10_000n : (mark * (10_000n - slipBps)) / 10_000n;
  const signedAt = BigInt((await up.chainNow()) - 1);

  const intent = {
    user: user.wallet as `0x${string}`,
    instrumentId: q.instrumentId,
    isLong,
    margin: BigInt(Math.round(q.marginUsd * 1e6)),
    leverage: BigInt(q.leverage),
    priceLimit,
    signedAt,
    nonce: randomUint256(),
  };
  const account = agentAccount(user, agentKey);
  const signature = await account.signTypedData({
    domain: cfg.eip712.domain,
    types: { Open: cfg.eip712.types.Open },
    primaryType: "Open",
    message: intent,
  });

  const bet: Bet = {
    id: `${user.wallet.slice(2, 8)}${intent.nonce.toString(36).slice(0, 10)}`,
    wallet: user.wallet,
    market: q.market,
    instrumentId: q.instrumentId,
    side: input.side,
    leverage: q.leverage,
    marginUsd: q.marginUsd,
    entryPrice: null,
    liquidationPrice: null,
    positionId: null,
    intentId: null,
    txHash: null,
    status: "pending",
    openedAt: Math.floor(Date.now() / 1000),
    closedAt: null,
    exitPrice: null,
    pnlUsd: null,
    closeTxHash: null,
    error: null,
  };
  store.insertBet(bet);

  try {
    const submitted = await up.submitIntent("open", stringify(intent), signature);
    store.updateBet(bet.id, { intentId: submitted.id });
    const result = await waitForIntent(submitted.id);
    if (result.status === "failed") {
      store.updateBet(bet.id, { status: "failed", error: `${result.code}: ${result.message}` });
      throw new BetError(`JackTrade rejected the bet: ${result.message} (${result.code}).`);
    }
    if (result.status !== "executed") {
      store.updateBet(bet.id, { txHash: "txHash" in result ? result.txHash : null });
      return { bet: store.bet(bet.id)!, txUrl: null, message: "Bet submitted; still confirming onchain." };
    }
    const entry = Number(result.price) / 1e18;
    const patch: Partial<Bet> = {
      status: "open",
      positionId: result.positionId ?? null,
      txHash: result.txHash,
      entryPrice: entry,
      liquidationPrice: liquidationPrice(entry, q.leverage, input.side),
    };
    store.updateBet(bet.id, patch);
    return { bet: store.bet(bet.id)!, txUrl: txLink(result.txHash), message: "Bet placed against the house." };
  } catch (err) {
    if (!(err instanceof BetError)) store.updateBet(bet.id, { status: "failed", error: String(err) });
    throw err;
  }
}

export async function cashOut(positionId: string, user: User, agentKey: `0x${string}`, store: Store) {
  const open = await up.positions(user.wallet);
  const pos = open.find((p) => p.id === positionId);
  if (!pos) throw new BetError(`Position ${positionId} is not open (it may have been liquidated or closed).`);
  const preview = await up.closePreview(positionId).catch(() => null);

  const cfg = await up.relayerConfig();
  const { price } = await resolveMarket(pos.market);
  if (!price) throw new BetError("No live price.");
  if (price.marketOpen === false) throw new BetError(`${pos.market} is outside market hours; you can cash out when it reopens.`);
  const mark = priceWad(price);
  const slip = BigInt(DEFAULT_SLIPPAGE_BPS);
  // Long exits sell, so the limit is a minimum; short exits buy back, so it's a maximum.
  const priceLimit = pos.side === "long" ? (mark * (10_000n - slip)) / 10_000n : (mark * (10_000n + slip)) / 10_000n;
  const intent = {
    user: user.wallet as `0x${string}`,
    positionId: BigInt(positionId),
    priceLimit,
    signedAt: BigInt((await up.chainNow()) - 1),
    nonce: randomUint256(),
  };
  const signature = await agentAccount(user, agentKey).signTypedData({
    domain: cfg.eip712.domain,
    types: { Close: cfg.eip712.types.Close },
    primaryType: "Close",
    message: intent,
  });
  const submitted = await up.submitIntent("close", stringify(intent), signature);
  const result = await waitForIntent(submitted.id);
  if (result.status === "failed") throw new BetError(`JackTrade rejected the cash out: ${result.message} (${result.code}).`);
  if (result.status !== "executed") return { message: "Cash out submitted; still confirming onchain.", txUrl: null };

  const exit = Number(result.price) / 1e18;
  const pnl = preview ? Number(preview.pnl) : null;
  const bet = store.betByPosition(user.wallet, positionId);
  if (bet) {
    store.updateBet(bet.id, {
      status: "closed",
      closedAt: Math.floor(Date.now() / 1000),
      exitPrice: exit,
      pnlUsd: pnl,
      closeTxHash: result.txHash,
    });
  }
  return {
    message: "Cashed out.",
    exitPrice: exit,
    estimatedPnlUsd: pnl,
    paidNowUsd: preview ? Number(preview.paidNow) : null,
    queuedUsd: preview ? Number(preview.queued) : null,
    txUrl: txLink(result.txHash),
  };
}

/** Marks open bets that the indexer no longer shows as open as closed or liquidated. */
export async function syncBets(store: Store, bets: Bet[]): Promise<void> {
  const wallets = [...new Set(bets.filter((b) => b.status === "open" && b.positionId).map((b) => b.wallet))];
  await Promise.all(
    wallets.map(async (wallet) => {
      try {
        const open = new Set((await up.positions(wallet)).map((p) => p.id));
        const stale = bets.filter((b) => b.wallet === wallet && b.status === "open" && b.positionId && !open.has(b.positionId));
        if (stale.length === 0) return;
        const { items } = await up.history(wallet);
        for (const b of stale) {
          const h = items.find((i) => (i.type === "close" || i.type === "liquidation") && i.id === b.positionId);
          if (!h) continue;
          store.updateBet(b.id, {
            status: h.type === "liquidation" ? "liquidated" : "closed",
            closedAt: h.at,
            exitPrice: h.exitPrice ? Number(h.exitPrice) : null,
            pnlUsd: h.pnl ? Number(h.pnl) : null,
            closeTxHash: h.tx,
          });
        }
      } catch {
        // Indexer hiccups shouldn't break the feed.
      }
    }),
  );
}

function stringify(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
}

export { USD, WAD };
export const explorer = config.explorerUrl;
