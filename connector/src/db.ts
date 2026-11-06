import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Caps = { maxMarginUsd: number; maxLeverage: number; dailyLossUsd: number };

export type User = {
  tokenHash: string;
  wallet: string;
  agentAddress: string;
  agentKeyEnc: string;
  caps: Caps;
  createdAt: number;
};

export type Pending = {
  pendingId: string;
  wallet: string;
  agentAddress: string;
  agentKeyEnc: string;
  expiry: number;
  createdAt: number;
};

export type BetStatus = "pending" | "open" | "closed" | "liquidated" | "failed";

export type Bet = {
  id: string;
  wallet: string;
  market: string;
  instrumentId: number;
  side: "long" | "short";
  leverage: number;
  marginUsd: number;
  entryPrice: number | null;
  liquidationPrice: number | null;
  positionId: string | null;
  intentId: string | null;
  txHash: string | null;
  status: BetStatus;
  openedAt: number;
  closedAt: number | null;
  exitPrice: number | null;
  pnlUsd: number | null;
  closeTxHash: string | null;
  error: string | null;
};

export type TriggerStatus = "armed" | "firing" | "fired" | "failed" | "cancelled" | "expired";

export type Trigger = {
  id: string;
  tokenHash: string;
  wallet: string;
  market: string;
  condition: "above" | "below";
  price: number;
  side: "long" | "short";
  marginUsd: number;
  leverage: number;
  status: TriggerStatus;
  createdAt: number;
  expiresAt: number;
  firedAt: number | null;
  betId: string | null;
  error: string | null;
};

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        token_hash TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        agent_address TEXT NOT NULL,
        agent_key_enc TEXT NOT NULL,
        caps TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending (
        pending_id TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        agent_address TEXT NOT NULL,
        agent_key_enc TEXT NOT NULL,
        expiry INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bets (
        id TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        market TEXT NOT NULL,
        instrument_id INTEGER NOT NULL,
        side TEXT NOT NULL,
        leverage INTEGER NOT NULL,
        margin_usd REAL NOT NULL,
        entry_price REAL,
        liquidation_price REAL,
        position_id TEXT,
        intent_id TEXT,
        tx_hash TEXT,
        status TEXT NOT NULL,
        opened_at INTEGER NOT NULL,
        closed_at INTEGER,
        exit_price REAL,
        pnl_usd REAL,
        close_tx_hash TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS bets_wallet ON bets(wallet, opened_at);
      CREATE TABLE IF NOT EXISTS triggers (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        wallet TEXT NOT NULL,
        market TEXT NOT NULL,
        condition TEXT NOT NULL,
        price REAL NOT NULL,
        side TEXT NOT NULL,
        margin_usd REAL NOT NULL,
        leverage INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        fired_at INTEGER,
        bet_id TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS triggers_status ON triggers(status);
    `);
  }

  savePending(p: Pending): void {
    this.db
      .prepare("INSERT INTO pending VALUES (?, ?, ?, ?, ?, ?)")
      .run(p.pendingId, p.wallet, p.agentAddress, p.agentKeyEnc, p.expiry, p.createdAt);
  }

  takePending(pendingId: string): Pending | null {
    const row = this.db.prepare("SELECT * FROM pending WHERE pending_id = ?").get(pendingId) as
      | Record<string, any>
      | undefined;
    if (!row) return null;
    return {
      pendingId: row.pending_id,
      wallet: row.wallet,
      agentAddress: row.agent_address,
      agentKeyEnc: row.agent_key_enc,
      expiry: row.expiry,
      createdAt: row.created_at,
    };
  }

  deletePending(pendingId: string): void {
    this.db.prepare("DELETE FROM pending WHERE pending_id = ?").run(pendingId);
  }

  saveUser(u: User): void {
    this.db
      .prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)")
      .run(u.tokenHash, u.wallet, u.agentAddress, u.agentKeyEnc, JSON.stringify(u.caps), u.createdAt);
  }

  userByTokenHash(tokenHash: string): User | null {
    const row = this.db.prepare("SELECT * FROM users WHERE token_hash = ?").get(tokenHash) as
      | Record<string, any>
      | undefined;
    if (!row) return null;
    return {
      tokenHash: row.token_hash,
      wallet: row.wallet,
      agentAddress: row.agent_address,
      agentKeyEnc: row.agent_key_enc,
      caps: JSON.parse(row.caps),
      createdAt: row.created_at,
    };
  }

  insertBet(b: Bet): void {
    this.db
      .prepare(
        `INSERT INTO bets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        b.id, b.wallet, b.market, b.instrumentId, b.side, b.leverage, b.marginUsd,
        b.entryPrice, b.liquidationPrice, b.positionId, b.intentId, b.txHash, b.status,
        b.openedAt, b.closedAt, b.exitPrice, b.pnlUsd, b.closeTxHash, b.error,
      );
  }

  updateBet(id: string, patch: Partial<Bet>): void {
    const cols: Record<keyof Bet, string> = {
      id: "id", wallet: "wallet", market: "market", instrumentId: "instrument_id", side: "side",
      leverage: "leverage", marginUsd: "margin_usd", entryPrice: "entry_price",
      liquidationPrice: "liquidation_price", positionId: "position_id", intentId: "intent_id",
      txHash: "tx_hash", status: "status", openedAt: "opened_at", closedAt: "closed_at",
      exitPrice: "exit_price", pnlUsd: "pnl_usd", closeTxHash: "close_tx_hash", error: "error",
    };
    const keys = Object.keys(patch) as (keyof Bet)[];
    if (keys.length === 0) return;
    const sql = `UPDATE bets SET ${keys.map((k) => `${cols[k]} = ?`).join(", ")} WHERE id = ?`;
    this.db.prepare(sql).run(...keys.map((k) => (patch[k] ?? null) as any), id);
  }

  bet(id: string): Bet | null {
    const row = this.db.prepare("SELECT * FROM bets WHERE id = ?").get(id) as Record<string, any> | undefined;
    return row ? toBet(row) : null;
  }

  betByPosition(wallet: string, positionId: string): Bet | null {
    const row = this.db
      .prepare("SELECT * FROM bets WHERE wallet = ? AND position_id = ?")
      .get(wallet, positionId) as Record<string, any> | undefined;
    return row ? toBet(row) : null;
  }

  recentBets(limit: number): Bet[] {
    const rows = this.db
      .prepare("SELECT * FROM bets WHERE status != 'failed' ORDER BY opened_at DESC LIMIT ?")
      .all(limit) as Record<string, any>[];
    return rows.map(toBet);
  }

  betsByWallet(wallet: string, sinceSec: number): Bet[] {
    const rows = this.db
      .prepare("SELECT * FROM bets WHERE wallet = ? AND opened_at >= ? ORDER BY opened_at DESC")
      .all(wallet, sinceSec) as Record<string, any>[];
    return rows.map(toBet);
  }
  insertTrigger(t: Trigger): void {
    this.db
      .prepare("INSERT INTO triggers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(t.id, t.tokenHash, t.wallet, t.market, t.condition, t.price, t.side, t.marginUsd, t.leverage,
        t.status, t.createdAt, t.expiresAt, t.firedAt, t.betId, t.error);
  }

  /** Atomically moves a trigger between states; returns false if it wasn't in `from`. */
  transitionTrigger(id: string, from: string, patch: { status: string; firedAt?: number; betId?: string | null; error?: string | null }): boolean {
    const r = this.db
      .prepare("UPDATE triggers SET status = ?, fired_at = COALESCE(?, fired_at), bet_id = COALESCE(?, bet_id), error = COALESCE(?, error) WHERE id = ? AND status = ?")
      .run(patch.status, patch.firedAt ?? null, patch.betId ?? null, patch.error ?? null, id, from);
    return Number(r.changes) === 1;
  }

  armedTriggers(): Trigger[] {
    return (this.db.prepare("SELECT * FROM triggers WHERE status = 'armed'").all() as Record<string, any>[]).map(toTrigger);
  }

  triggersByWallet(wallet: string): Trigger[] {
    return (this.db
      .prepare("SELECT * FROM triggers WHERE wallet = ? ORDER BY created_at DESC LIMIT 50")
      .all(wallet) as Record<string, any>[]).map(toTrigger);
  }

  recentTriggers(limit: number): Trigger[] {
    return (this.db
      .prepare("SELECT * FROM triggers ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, any>[]).map(toTrigger);
  }
}

function toTrigger(r: Record<string, any>): Trigger {
  return {
    id: r.id,
    tokenHash: r.token_hash,
    wallet: r.wallet,
    market: r.market,
    condition: r.condition,
    price: r.price,
    side: r.side,
    marginUsd: r.margin_usd,
    leverage: r.leverage,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    firedAt: r.fired_at,
    betId: r.bet_id,
    error: r.error,
  };
}

function toBet(r: Record<string, any>): Bet {
  return {
    id: r.id,
    wallet: r.wallet,
    market: r.market,
    instrumentId: r.instrument_id,
    side: r.side,
    leverage: r.leverage,
    marginUsd: r.margin_usd,
    entryPrice: r.entry_price,
    liquidationPrice: r.liquidation_price,
    positionId: r.position_id,
    intentId: r.intent_id,
    txHash: r.tx_hash,
    status: r.status,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    exitPrice: r.exit_price,
    pnlUsd: r.pnl_usd,
    closeTxHash: r.close_tx_hash,
    error: r.error,
  };
}
