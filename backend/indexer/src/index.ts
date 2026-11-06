/**
 * Handlers: cada evento actualiza las tablas de ponder.schema.ts. Ponder los corre en orden de bloque y de log,
 * y deshace los cambios si hay un reorg.
 */
import { eq } from "ponder";
import { ponder, type Context } from "ponder:registry";
import { activity, market, marketPoint, position, protocol, protocolPoint, queueEntry, sessionKey, stake, trader, transfer } from "ponder:schema";
import type { Hex } from "viem";

type Db = Context["db"];

const PROTOCOL = { id: 1 };
// En el fork el indexado arranca en el bloque del fork, pero la copia trae posiciones y fila de antes: un evento sobre
// algo que no se vio crear se saltea con aviso. En mainnet se indexa desde el deploy, así que eso sería un error real.
const lenient = process.env.NETWORK === "fork";
function missing(what: string) {
  if (!lenient) throw new Error(`${what}: no se vio su creación (¿el indexado empezó tarde?)`);
  console.warn(`[indexer] ${what}: anterior al fork, se saltea`);
}
const protocolDefaults = {
  ...PROTOCOL,
  trades: 0,
  open: 0,
  volume: 0n,
  fees: 0n,
  traderPnl: 0n,
  deposits: 0n,
  withdrawals: 0n,
  totalQueued: 0n,
  paused: false,
  stakerFeesPushed: 0n,
  lpExcessPushed: 0n,
  rewardsNotified: 0n,
};
const marketDefaults = (id: number) => ({ id, listed: false, retired: false, longOi: 0n, shortOi: 0n, open: 0, trades: 0, volume: 0n, liquidations: 0 });
const traderDefaults = (address: Hex, now: bigint) => ({
  address,
  trades: 0,
  open: 0,
  wins: 0,
  losses: 0,
  liquidations: 0,
  volume: 0n,
  realizedPnl: 0n,
  feesPaid: 0n,
  minted: 0n,
  deposited: 0n,
  withdrawn: 0n,
  firstSeen: now,
  lastActive: now,
});

// Las filas únicas se crean la primera vez que hacen falta.
async function protocolRow(db: Db) {
  return (await db.find(protocol, PROTOCOL)) ?? (await db.insert(protocol).values(protocolDefaults));
}
async function updateProtocol(db: Db, fn: (p: typeof protocol.$inferSelect) => Partial<typeof protocol.$inferInsert>) {
  await protocolRow(db);
  await db.update(protocol, PROTOCOL).set(fn);
}
async function updateMarket(db: Db, id: number, fn: (m: typeof market.$inferSelect) => Partial<typeof market.$inferInsert>) {
  if (!(await db.find(market, { id }))) await db.insert(market).values(marketDefaults(id));
  await db.update(market, { id }).set(fn);
}
async function updateTrader(db: Db, address: Hex, now: bigint, fn: (t: typeof trader.$inferSelect) => Partial<typeof trader.$inferInsert>) {
  if (!(await db.find(trader, { address }))) await db.insert(trader).values(traderDefaults(address, now));
  await db.update(trader, { address }).set((t) => ({ ...fn(t), lastActive: now }));
}

// ---------------------------------------------------------------- actividad y series
// Un registro por evento (feed global y por usuario) y una foto de los totales después de cada cambio (gráficos).

type Ev = { block: { number: bigint; timestamp: bigint }; transaction: { hash: Hex }; log: { logIndex: number } };
const evId = (e: Ev) => `${e.transaction.hash}-${e.log.logIndex}`;
const seqOf = (e: Ev) => e.block.number * 1_000_000n + BigInt(e.log.logIndex);

async function record(db: Db, e: Ev, row: Omit<typeof activity.$inferInsert, "id" | "seq" | "timestamp" | "tx">) {
  await db.insert(activity).values({ ...row, id: evId(e), seq: seqOf(e), timestamp: e.block.timestamp, tx: e.transaction.hash }).onConflictDoNothing();
}

async function protocolSnapshot(db: Db, e: Ev) {
  const p = await protocolRow(db);
  const markets = await db.sql.select().from(market);
  const longOi = markets.reduce((a, m) => a + m.longOi, 0n);
  const shortOi = markets.reduce((a, m) => a + m.shortOi, 0n);
  await db
    .insert(protocolPoint)
    .values({
      id: evId(e),
      seq: seqOf(e),
      timestamp: e.block.timestamp,
      traderPnl: p.traderPnl,
      fees: p.fees,
      totalQueued: p.totalQueued,
      deposits: p.deposits,
      withdrawals: p.withdrawals,
      stakerFeesPushed: p.stakerFeesPushed,
      volume: p.volume,
      open: p.open,
      longOi,
      shortOi,
    })
    .onConflictDoNothing();
}

async function marketSnapshot(db: Db, e: Ev, instrumentId: number) {
  const m = await db.find(market, { id: instrumentId });
  if (!m) return;
  await db.insert(marketPoint).values({ id: evId(e), seq: seqOf(e), instrumentId, timestamp: e.block.timestamp, longOi: m.longOi, shortOi: m.shortOi }).onConflictDoNothing();
}

// ---------------------------------------------------------------- posiciones

ponder.on("Exchange:PositionOpened", async ({ event, context }) => {
  const { positionId, user, instrumentId, isLong, margin, leverage, entryPrice } = event.args;
  const now = event.block.timestamp;
  const notional = margin * leverage;
  await context.db.insert(position).values({
    id: positionId,
    user,
    instrumentId,
    isLong,
    margin,
    leverage,
    notional,
    entryPrice,
    status: "open",
    openedAt: now,
    openTx: event.transaction.hash,
  });
  await updateMarket(context.db, instrumentId, (m) => ({
    longOi: m.longOi + (isLong ? notional : 0n),
    shortOi: m.shortOi + (isLong ? 0n : notional),
    open: m.open + 1,
    trades: m.trades + 1,
    volume: m.volume + notional,
  }));
  await updateTrader(context.db, user, now, (t) => ({ trades: t.trades + 1, open: t.open + 1, volume: t.volume + notional }));
  await updateProtocol(context.db, (p) => ({ trades: p.trades + 1, open: p.open + 1, volume: p.volume + notional }));
  await record(context.db, event, { kind: "open", user, instrumentId, positionId, isLong, leverage, notional, price: entryPrice, amount: margin });
  await marketSnapshot(context.db, event, instrumentId);
  await protocolSnapshot(context.db, event);
});

/** Cierre o liquidación: saca el OI del mercado y suma el resultado al usuario y al protocolo. */
async function settle(
  db: Db,
  e: Ev,
  positionId: bigint,
  result: { status: "closed" | "liquidated"; exitPrice: bigint; payout: bigint; loss: bigint; fee: bigint },
) {
  const now = e.block.timestamp;
  const tx = e.transaction.hash;
  const p = await db.find(position, { id: positionId });
  if (!p) return missing(`posición ${positionId} sin PositionOpened`);
  const pnl = result.payout - result.loss;
  await db.update(position, { id: positionId }).set({ ...result, pnl, closedAt: now, closeTx: tx });
  await updateMarket(db, p.instrumentId, (m) => ({
    longOi: m.longOi - (p.isLong ? p.notional : 0n),
    shortOi: m.shortOi - (p.isLong ? 0n : p.notional),
    open: m.open - 1,
    liquidations: m.liquidations + (result.status === "liquidated" ? 1 : 0),
  }));
  await updateTrader(db, p.user, now, (t) => ({
    open: t.open - 1,
    wins: t.wins + (pnl > 0n ? 1 : 0),
    losses: t.losses + (pnl < 0n ? 1 : 0),
    liquidations: t.liquidations + (result.status === "liquidated" ? 1 : 0),
    realizedPnl: t.realizedPnl + pnl,
    feesPaid: t.feesPaid + result.fee,
  }));
  await updateProtocol(db, (s) => ({ open: s.open - 1, fees: s.fees + result.fee, traderPnl: s.traderPnl + pnl }));
  await record(db, e, {
    kind: result.status === "liquidated" ? "liquidation" : "close",
    user: p.user,
    instrumentId: p.instrumentId,
    positionId,
    isLong: p.isLong,
    leverage: p.leverage,
    notional: p.notional,
    price: result.exitPrice,
    amount: pnl,
  });
  await marketSnapshot(db, e, p.instrumentId);
  await protocolSnapshot(db, e);
}

ponder.on("Exchange:PositionClosed", async ({ event, context }) => {
  const { positionId, exitPrice, payout, loss, fee } = event.args;
  await settle(context.db, event, positionId, { status: "closed", exitPrice, payout, loss, fee });
});

ponder.on("Exchange:PositionLiquidated", async ({ event, context }) => {
  const { positionId, price, margin, fee } = event.args;
  // Una liquidación pierde todo el margen (el contrato no devuelve nada).
  await settle(context.db, event, positionId, { status: "liquidated", exitPrice: price, payout: 0n, loss: margin, fee });
});

ponder.on("Exchange:TokensMinted", async ({ event, context }) => {
  await updateTrader(context.db, event.args.user, event.block.timestamp, (t) => ({ minted: t.minted + event.args.amount }));
  await record(context.db, event, { kind: "mint", user: event.args.user, amount: event.args.amount });
});

// ---------------------------------------------------------------- depósitos y retiros

ponder.on("Exchange:Deposited", async ({ event, context }) => {
  const { user, amount, activationFee } = event.args;
  await context.db.insert(transfer).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    user,
    kind: "deposit",
    amount,
    activationFee: activationFee > 0n ? activationFee : null,
    timestamp: event.block.timestamp,
    tx: event.transaction.hash,
  });
  await updateTrader(context.db, user, event.block.timestamp, (t) => ({ deposited: t.deposited + amount }));
  await updateProtocol(context.db, (p) => ({ deposits: p.deposits + amount }));
  await record(context.db, event, { kind: "deposit", user, amount });
  await protocolSnapshot(context.db, event);
});

ponder.on("Exchange:Withdrawn", async ({ event, context }) => {
  const { user, to, amount } = event.args;
  await context.db.insert(transfer).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    user,
    kind: "withdraw",
    amount,
    to,
    timestamp: event.block.timestamp,
    tx: event.transaction.hash,
  });
  await updateTrader(context.db, user, event.block.timestamp, (t) => ({ withdrawn: t.withdrawn + amount }));
  await updateProtocol(context.db, (p) => ({ withdrawals: p.withdrawals + amount }));
  await record(context.db, event, { kind: "withdraw", user, amount });
  await protocolSnapshot(context.db, event);
});

// ---------------------------------------------------------------- fila

ponder.on("Exchange:PayoutQueued", async ({ event, context }) => {
  const { index, user, amount } = event.args;
  await context.db.insert(queueEntry).values({ index, user, amount, remaining: amount, paid: 0n, queuedAt: event.block.timestamp, tx: event.transaction.hash });
  await updateProtocol(context.db, (p) => ({ totalQueued: p.totalQueued + amount }));
  await record(context.db, event, { kind: "queued", user, amount });
  await protocolSnapshot(context.db, event);
});

ponder.on("Exchange:QueuePaid", async ({ event, context }) => {
  const { index, user, amount } = event.args;
  if (!(await context.db.find(queueEntry, { index }))) return missing(`entrada ${index} de la fila sin PayoutQueued`);
  await context.db.update(queueEntry, { index }).set((e) => ({
    remaining: e.remaining - amount,
    paid: e.paid + amount,
    paidAt: e.remaining === amount ? event.block.timestamp : null,
  }));
  await updateProtocol(context.db, (p) => ({ totalQueued: p.totalQueued - amount }));
  await record(context.db, event, { kind: "queuePaid", user, amount });
  await protocolSnapshot(context.db, event);
});

// ---------------------------------------------------------------- mercados y protocolo

ponder.on("Exchange:MarketListed", async ({ event, context }) => {
  await updateMarket(context.db, event.args.instrumentId, () => ({ listed: true }));
});

ponder.on("Exchange:MarketRetired", async ({ event, context }) => {
  await updateMarket(context.db, event.args.instrumentId, () => ({ retired: true, frozenPrice: event.args.frozenPrice }));
});

ponder.on("Exchange:TradingPausedSet", async ({ event, context }) => {
  await updateProtocol(context.db, () => ({ paused: event.args.paused }));
});

ponder.on("Exchange:Heartbeat", async ({ event, context }) => {
  await updateProtocol(context.db, () => ({ lastHeartbeat: event.block.timestamp }));
});

ponder.on("Exchange:StakerFeesPushed", async ({ event, context }) => {
  await updateProtocol(context.db, (p) => ({ stakerFeesPushed: p.stakerFeesPushed + event.args.fees, lpExcessPushed: p.lpExcessPushed + event.args.lpExcess }));
  await record(context.db, event, { kind: "distribution", amount: event.args.fees + event.args.lpExcess });
  await protocolSnapshot(context.db, event);
});

// ---------------------------------------------------------------- staking

async function updateStake(db: Db, user: Hex, now: bigint, fn: (s: typeof stake.$inferSelect) => Partial<typeof stake.$inferInsert>) {
  if (!(await db.find(stake, { user }))) await db.insert(stake).values({ user, staked: 0n, claimed: 0n, credited: 0n, updatedAt: now });
  await db.update(stake, { user }).set((s) => ({ ...fn(s), updatedAt: now }));
}

ponder.on("JackTradeStaking:Staked", async ({ event, context }) => {
  await updateStake(context.db, event.args.user, event.block.timestamp, (s) => ({ staked: s.staked + event.args.amount }));
  await record(context.db, event, { kind: "stake", user: event.args.user, amount: event.args.amount });
});

ponder.on("JackTradeStaking:Unstaked", async ({ event, context }) => {
  await updateStake(context.db, event.args.user, event.block.timestamp, (s) => ({ staked: s.staked - event.args.amount }));
  await record(context.db, event, { kind: "unstake", user: event.args.user, amount: event.args.amount });
});

ponder.on("JackTradeStaking:Claimed", async ({ event, context }) => {
  await updateStake(context.db, event.args.user, event.block.timestamp, (s) => ({ claimed: s.claimed + event.args.amount }));
  await record(context.db, event, { kind: "claim", user: event.args.user, amount: event.args.amount });
});

ponder.on("JackTradeStaking:RewardNotified", async ({ event, context }) => {
  await updateProtocol(context.db, (p) => ({ rewardsNotified: p.rewardsNotified + event.args.amount }));
});

ponder.on("Exchange:StakingRewardCredited", async ({ event, context }) => {
  await updateStake(context.db, event.args.user, event.block.timestamp, (s) => ({ credited: s.credited + event.args.amount }));
});

// ---------------------------------------------------------------- session keys

ponder.on("SessionKeyManager:SessionKeyRegistered", async ({ event, context }) => {
  const { user, key, expiry } = event.args;
  // Registrar la misma key de nuevo la reactiva con el nuevo vencimiento.
  await context.db
    .insert(sessionKey)
    .values({ id: `${user}-${key}`, user, key, expiry, revoked: false, registeredAt: event.block.timestamp })
    .onConflictDoUpdate({ expiry, revoked: false, registeredAt: event.block.timestamp });
});

ponder.on("SessionKeyManager:SessionKeyRevoked", async ({ event, context }) => {
  const { user, key } = event.args;
  if (await context.db.find(sessionKey, { id: `${user}-${key}` })) await context.db.update(sessionKey, { id: `${user}-${key}` }).set({ revoked: true });
});

ponder.on("SessionKeyManager:AllSessionKeysRevoked", async ({ event, context }) => {
  // Sube el epoch: todas las keys registradas antes dejan de valer.
  await context.db.sql.update(sessionKey).set({ revoked: true }).where(eq(sessionKey.user, event.args.user));
});
