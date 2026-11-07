import { index, onchainTable } from "ponder";

/**
 * Tablas del indexer. Montos en unidades de USDG (6 decimales), precios en WAD (18), tiempos en segundos de bloque.
 * El balance libre de cada usuario no se reconstruye acá (cambia en demasiados lugares): la API lo lee de la cadena.
 */

/** Cada posición, abierta o terminada. */
export const position = onchainTable(
  "position",
  (t) => ({
    id: t.bigint().primaryKey(),
    user: t.hex().notNull(),
    instrumentId: t.integer().notNull(),
    isLong: t.boolean().notNull(),
    margin: t.bigint().notNull(),
    leverage: t.bigint().notNull(),
    notional: t.bigint().notNull(), // margin × leverage
    entryPrice: t.bigint().notNull(),
    status: t.text().notNull(), // open | closed | liquidated
    openedAt: t.bigint().notNull(),
    openTx: t.hex().notNull(),
    exitPrice: t.bigint(),
    payout: t.bigint(), // ganancia neta (después de fee), pagada o en fila
    loss: t.bigint(),
    fee: t.bigint(),
    pnl: t.bigint(), // payout − loss
    closedAt: t.bigint(),
    closeTx: t.hex(),
  }),
  (t) => ({ userIdx: index().on(t.user), statusIdx: index().on(t.status), instrumentIdx: index().on(t.instrumentId), openedIdx: index().on(t.instrumentId, t.openedAt), closedIdx: index().on(t.closedAt) }),
);

/** Totales por usuario: historial resumido y leaderboard. */
export const trader = onchainTable(
  "trader",
  (t) => ({
    address: t.hex().primaryKey(),
    trades: t.integer().notNull(),
    open: t.integer().notNull(),
    wins: t.integer().notNull(),
    losses: t.integer().notNull(),
    liquidations: t.integer().notNull(),
    volume: t.bigint().notNull(), // notional abierto
    realizedPnl: t.bigint().notNull(),
    feesPaid: t.bigint().notNull(),
    minted: t.bigint().notNull(), // JACKTRADE (18 decimales)
    deposited: t.bigint().notNull(),
    withdrawn: t.bigint().notNull(),
    firstSeen: t.bigint().notNull(),
    lastActive: t.bigint().notNull(),
  }),
  (t) => ({ pnlIdx: index().on(t.realizedPnl), volumeIdx: index().on(t.volume) }),
);

/** Depósitos y retiros. */
export const transfer = onchainTable(
  "transfer",
  (t) => ({
    id: t.text().primaryKey(), // tx-logIndex
    user: t.hex().notNull(),
    kind: t.text().notNull(), // deposit | withdraw
    amount: t.bigint().notNull(),
    activationFee: t.bigint(), // solo en el primer depósito
    to: t.hex(), // solo en retiros
    timestamp: t.bigint().notNull(),
    tx: t.hex().notNull(),
  }),
  (t) => ({ userIdx: index().on(t.user) }),
);

/** La fila de ganadores en espera, en orden de index (FIFO). */
export const queueEntry = onchainTable(
  "queue_entry",
  (t) => ({
    index: t.bigint().primaryKey(),
    user: t.hex().notNull(),
    amount: t.bigint().notNull(), // lo que entró a la fila
    remaining: t.bigint().notNull(),
    paid: t.bigint().notNull(),
    queuedAt: t.bigint().notNull(),
    paidAt: t.bigint(), // cuando se completó
    tx: t.hex().notNull(),
  }),
  (t) => ({ userIdx: index().on(t.user), remainingIdx: index().on(t.remaining) }),
);

export const market = onchainTable("market", (t) => ({
  id: t.integer().primaryKey(),
  listed: t.boolean().notNull(),
  retired: t.boolean().notNull(),
  frozenPrice: t.bigint(),
  longOi: t.bigint().notNull(), // notional abierto
  shortOi: t.bigint().notNull(),
  open: t.integer().notNull(),
  trades: t.integer().notNull(),
  volume: t.bigint().notNull(),
  liquidations: t.integer().notNull(),
}));

/** Una sola fila (id = 1) con los totales del protocolo. */
export const protocol = onchainTable("protocol", (t) => ({
  id: t.integer().primaryKey(),
  trades: t.integer().notNull(),
  open: t.integer().notNull(),
  volume: t.bigint().notNull(),
  fees: t.bigint().notNull(), // fees de cierres y liquidaciones
  traderPnl: t.bigint().notNull(), // PnL realizado de todos los usuarios (negativo: ganó la casa)
  deposits: t.bigint().notNull(),
  withdrawals: t.bigint().notNull(),
  totalQueued: t.bigint().notNull(),
  paused: t.boolean().notNull(),
  lastHeartbeat: t.bigint(),
  stakerFeesPushed: t.bigint().notNull(),
  lpExcessPushed: t.bigint().notNull(),
  rewardsNotified: t.bigint().notNull(),
}));

/** Staking de JACKTRADE por usuario. */
export const stake = onchainTable("stake", (t) => ({
  user: t.hex().primaryKey(),
  staked: t.bigint().notNull(),
  claimed: t.bigint().notNull(),
  credited: t.bigint().notNull(), // recompensas acreditadas al balance del Exchange
  updatedAt: t.bigint().notNull(),
}));

export const sessionKey = onchainTable(
  "session_key",
  (t) => ({
    id: t.text().primaryKey(), // user-key
    user: t.hex().notNull(),
    key: t.hex().notNull(),
    expiry: t.bigint().notNull(),
    revoked: t.boolean().notNull(),
    registeredAt: t.bigint().notNull(),
  }),
  (t) => ({ userIdx: index().on(t.user) }),
);

/**
 * Todo lo que pasó, un registro por evento: el feed global (tape), la actividad de cada usuario y las distribuciones
 * a staking. `amount` según el tipo:
 * - open: margen · close/liquidation: PnL realizado (con signo) · deposit/withdraw/queued/queuePaid/claim/distribution: USDG
 * - stake/unstake/mint: JACKTRADE (18 decimales)
 */
export const activity = onchainTable(
  "activity",
  (t) => ({
    id: t.text().primaryKey(), // tx-logIndex
    seq: t.bigint().notNull(), // orden en la cadena: bloque × 1e6 + logIndex
    kind: t.text().notNull(), // open | close | liquidation | deposit | withdraw | queued | queuePaid | stake | unstake | claim | mint | distribution
    user: t.hex(), // null en distribution
    instrumentId: t.integer(),
    positionId: t.bigint(),
    isLong: t.boolean(),
    leverage: t.bigint(),
    notional: t.bigint(),
    price: t.bigint(), // entrada (open) o salida (close/liquidation), WAD
    amount: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    tx: t.hex().notNull(),
  }),
  (t) => ({ userIdx: index().on(t.user, t.seq), kindIdx: index().on(t.kind, t.seq), seqIdx: index().on(t.seq), timeIdx: index().on(t.timestamp) }),
);

/** Totales del protocolo después de cada evento que los cambia: series de la casa (PnL, fila, fees, OI) en el tiempo. */
export const protocolPoint = onchainTable(
  "protocol_point",
  (t) => ({
    id: t.text().primaryKey(), // tx-logIndex
    seq: t.bigint().notNull(), // orden en la cadena: bloque × 1e6 + logIndex
    timestamp: t.bigint().notNull(),
    traderPnl: t.bigint().notNull(),
    fees: t.bigint().notNull(),
    totalQueued: t.bigint().notNull(),
    deposits: t.bigint().notNull(),
    withdrawals: t.bigint().notNull(),
    stakerFeesPushed: t.bigint().notNull(),
    volume: t.bigint().notNull(),
    open: t.integer().notNull(),
    longOi: t.bigint().notNull(), // suma de todos los mercados
    shortOi: t.bigint().notNull(),
  }),
  (t) => ({ timeIdx: index().on(t.timestamp), seqIdx: index().on(t.seq) }),
);

/** OI de un mercado después de cada apertura, cierre o liquidación. */
export const marketPoint = onchainTable(
  "market_point",
  (t) => ({
    id: t.text().primaryKey(), // tx-logIndex
    seq: t.bigint().notNull(), // orden en la cadena: bloque × 1e6 + logIndex
    instrumentId: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    longOi: t.bigint().notNull(),
    shortOi: t.bigint().notNull(),
  }),
  (t) => ({ marketTimeIdx: index().on(t.instrumentId, t.timestamp), marketSeqIdx: index().on(t.instrumentId, t.seq) }),
);
