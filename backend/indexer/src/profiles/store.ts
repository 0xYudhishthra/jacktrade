import { randomBytes, randomUUID } from "node:crypto";

import type { Hex } from "viem";

/**
 * Off-chain, writable storage for profiles. Lives in its own schema (`hm_profiles`), apart from Ponder's tables, which
 * are rebuilt from chain events on every deploy: a username is not an on-chain event, so it must never be stored there.
 * - Production: the same Postgres as the indexer (`DATABASE_URL`), own schema, own small pool.
 * - Local / fork without Postgres: an embedded PGlite database on disk.
 */
type Sql = { query: <R>(text: string, params?: unknown[]) => Promise<{ rows: R[] }> };

export type Profile = { wallet: Hex; username: string; createdAt: Date; updatedAt: Date };
export type StoredChallenge = { id: string; wallet: Hex; username: string; nonce: Hex; expiresAt: Date; usedAt: Date | null };

const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS hm_profiles;
CREATE TABLE IF NOT EXISTS hm_profiles.profiles (
  wallet text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hm_profiles.challenges (
  id uuid PRIMARY KEY,
  wallet text NOT NULL,
  username text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenges_expires_at ON hm_profiles.challenges (expires_at);
`;

export class UsernameTaken extends Error {}

export async function openProfileStore({ databaseUrl = process.env.DATABASE_URL, localDir }: { databaseUrl?: string; localDir: string }) {
  let sql: Sql;
  let close: () => Promise<void>;
  if (databaseUrl) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    pool.on("error", (e) => console.error(`[profiles] postgres: ${e.message.split("\n")[0]}`));
    sql = { query: (text, params) => pool.query(text, params as unknown[]) as never };
    close = () => pool.end();
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(localDir);
    sql = { query: (text, params) => db.query(text, params as unknown[]) as never };
    close = () => db.close();
  }
  for (const statement of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await sql.query(statement);

  const toProfile = (r: { wallet: string; username: string; created_at: Date | string; updated_at: Date | string }): Profile => ({
    wallet: r.wallet as Hex,
    username: r.username,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  });
  const toChallenge = (r: { id: string; wallet: string; username: string; nonce: string; expires_at: Date | string; used_at: Date | string | null }): StoredChallenge => ({
    id: r.id,
    wallet: r.wallet as Hex,
    username: r.username,
    nonce: r.nonce as Hex,
    expiresAt: new Date(r.expires_at),
    usedAt: r.used_at ? new Date(r.used_at) : null,
  });

  return {
    close,

    async byWallet(wallet: Hex) {
      const { rows } = await sql.query<Parameters<typeof toProfile>[0]>("SELECT * FROM hm_profiles.profiles WHERE wallet = $1", [wallet]);
      return rows[0] ? toProfile(rows[0]) : undefined;
    },

    async byUsername(username: string) {
      const { rows } = await sql.query<Parameters<typeof toProfile>[0]>("SELECT * FROM hm_profiles.profiles WHERE username = $1", [username]);
      return rows[0] ? toProfile(rows[0]) : undefined;
    },

    /** wallet → username for the given wallets (leaderboard). */
    async usernames(wallets: Hex[]) {
      if (wallets.length === 0) return new Map<string, string>();
      const { rows } = await sql.query<{ wallet: string; username: string }>("SELECT wallet, username FROM hm_profiles.profiles WHERE wallet = ANY($1)", [wallets]);
      return new Map(rows.map((r) => [r.wallet, r.username]));
    },

    async createChallenge(wallet: Hex, username: string, ttlSeconds: number) {
      const c: StoredChallenge = {
        id: randomUUID(),
        wallet,
        username,
        nonce: `0x${randomBytes(32).toString("hex")}` as Hex,
        expiresAt: new Date(Math.floor(Date.now() / 1000 + ttlSeconds) * 1000),
        usedAt: null,
      };
      await sql.query("INSERT INTO hm_profiles.challenges (id, wallet, username, nonce, expires_at) VALUES ($1, $2, $3, $4, $5)", [c.id, c.wallet, c.username, c.nonce, c.expiresAt]);
      return c;
    },

    async challenge(id: string) {
      const { rows } = await sql.query<Parameters<typeof toChallenge>[0]>("SELECT * FROM hm_profiles.challenges WHERE id = $1", [id]);
      return rows[0] ? toChallenge(rows[0]) : undefined;
    },

    /** Marks the challenge used. Atomic: of two concurrent requests with the same challenge, only one gets `true`. */
    async consumeChallenge(id: string) {
      const { rows } = await sql.query("UPDATE hm_profiles.challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL AND expires_at > now() RETURNING id", [id]);
      return rows.length === 1;
    },

    /** Creates or changes the wallet's username. Throws UsernameTaken if another wallet has it. */
    async setUsername(wallet: Hex, username: string) {
      try {
        const { rows } = await sql.query<Parameters<typeof toProfile>[0]>(
          `INSERT INTO hm_profiles.profiles (wallet, username) VALUES ($1, $2)
           ON CONFLICT (wallet) DO UPDATE SET username = EXCLUDED.username,
             updated_at = CASE WHEN hm_profiles.profiles.username = EXCLUDED.username THEN hm_profiles.profiles.updated_at ELSE now() END
           RETURNING *`,
          [wallet, username],
        );
        return toProfile(rows[0]!);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new UsernameTaken(username); // unique violation on username
        throw e;
      }
    },

    /** Deletes challenges expired more than an hour ago (used ones too). */
    async pruneChallenges() {
      await sql.query("DELETE FROM hm_profiles.challenges WHERE expires_at < now() - interval '1 hour'");
    },
  };
}

export type ProfileStore = Awaited<ReturnType<typeof openProfileStore>>;
