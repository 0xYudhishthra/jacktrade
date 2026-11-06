import { config } from "./config.ts";
import { decrypt, newSecret } from "./crypto.ts";
import type { Store, Trigger, User } from "./db.ts";
import { BetError, placeBet, quote, resolveMarket, type Side } from "./trading.ts";
import * as up from "./upstream.ts";

// Conditional bets: Grok arms "if TSLA drops below $350, short 20x with $20" and the connector
// fires it the moment the live price crosses. The bet goes through the same caps and signing
// path as a manual place_bet.

const POLL_MS = 3_000;
const MAX_ARMED_PER_WALLET = 5;

export type ArmInput = {
  market: string;
  condition: "above" | "below";
  price: number;
  side: Side;
  marginUsd: number;
  leverage: number;
  expiresInHours?: number;
};

export async function armTrigger(input: ArmInput, user: User, store: Store): Promise<Trigger> {
  if (!(input.price > 0)) throw new BetError("Trigger price must be positive.");
  const armed = store.triggersByWallet(user.wallet).filter((t) => t.status === "armed");
  if (armed.length >= MAX_ARMED_PER_WALLET) throw new BetError(`You already have ${MAX_ARMED_PER_WALLET} armed triggers; cancel one first.`);

  // Validate everything a real bet would check (market, minimums, caps) before arming.
  const q = await quote(
    { market: input.market, side: input.side, marginUsd: input.marginUsd, leverage: input.leverage },
    user.caps,
    store,
    user.wallet,
  );
  const now = Math.floor(Date.now() / 1000);
  const hours = Math.min(Math.max(input.expiresInHours ?? 24, 0.1), 24 * 7);
  const already = input.condition === "below" ? q.entryPrice <= input.price : q.entryPrice >= input.price;
  if (already) {
    throw new BetError(
      `${q.market} is already ${input.condition} $${input.price} (now $${q.entryPrice.toFixed(2)}). Place the bet directly instead.`,
    );
  }
  const trigger: Trigger = {
    id: `t${newSecret(6)}`,
    tokenHash: user.tokenHash,
    wallet: user.wallet,
    market: q.market,
    condition: input.condition,
    price: input.price,
    side: input.side,
    marginUsd: input.marginUsd,
    leverage: input.leverage,
    status: "armed",
    createdAt: now,
    expiresAt: now + Math.round(hours * 3600),
    firedAt: null,
    betId: null,
    error: null,
  };
  store.insertTrigger(trigger);
  return trigger;
}

export function cancelTrigger(id: string, user: User, store: Store): boolean {
  const t = store.triggersByWallet(user.wallet).find((x) => x.id === id);
  if (!t) return false;
  return store.transitionTrigger(id, "armed", { status: "cancelled" });
}

function crossed(t: Trigger, price: number): boolean {
  return t.condition === "below" ? price <= t.price : price >= t.price;
}

async function tick(store: Store): Promise<void> {
  const armed = store.armedTriggers();
  if (armed.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  const prices = await up.prices();

  for (const t of armed) {
    if (t.expiresAt <= now) {
      store.transitionTrigger(t.id, "armed", { status: "expired" });
      continue;
    }
    const { market } = await resolveMarket(t.market).catch(() => ({ market: null }));
    const p = market ? prices.find((x) => x.market === market.id) : undefined;
    if (!p || p.marketOpen === false || !crossed(t, p.usd)) continue;

    // Claim it first so a slow fill can't fire twice.
    if (!store.transitionTrigger(t.id, "armed", { status: "firing", firedAt: now })) continue;
    const user = store.userByTokenHash(t.tokenHash);
    if (!user) {
      store.transitionTrigger(t.id, "firing", { status: "failed", error: "connector user not found" });
      continue;
    }
    try {
      const key = decrypt(user.agentKeyEnc, config.serverSecret) as `0x${string}`;
      const r = await placeBet(
        { market: t.market, side: t.side, marginUsd: t.marginUsd, leverage: t.leverage },
        user,
        key,
        store,
      );
      store.transitionTrigger(t.id, "firing", { status: "fired", betId: r.bet.id });
      console.log(`trigger ${t.id} fired → bet ${r.bet.id} (${t.market} ${t.condition} ${t.price}, now ${p.usd})`);
    } catch (err) {
      store.transitionTrigger(t.id, "firing", { status: "failed", error: err instanceof Error ? err.message : String(err) });
      console.warn(`trigger ${t.id} failed:`, err);
    }
  }
}

export function startTriggerWatcher(store: Store): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    tick(store)
      .catch((e) => console.warn("trigger tick error", e))
      .finally(() => {
        running = false;
      });
  }, POLL_MS);
}
