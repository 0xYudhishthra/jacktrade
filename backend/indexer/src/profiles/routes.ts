import { RateLimiter, clientIp, safeError } from "@hm/shared";
import type { Context, Hono } from "hono";
import type { Hex, PublicClient } from "viem";

import { challengeMessage, challengeTypedData, checkUsername, normalizeWallet, verifyChallengeSignature } from "./rules.js";
import { UsernameTaken, type Profile, type ProfileStore } from "./store.js";

/**
 * Public profiles API (all messages in English):
 *   GET  /api/profile/:wallet                 profile of a wallet (username null if it has none)
 *   GET  /api/profile/by-username/:username   resolves /u/:username to a wallet
 *   POST /api/profile/challenge               one-time challenge to sign
 *   PUT  /api/profile/username                set or change the username with the signed challenge
 */
export type ProfileErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_USERNAME"
  | "INVALID_SIGNATURE"
  | "PROFILE_NOT_FOUND"
  | "USERNAME_TAKEN"
  | "CHALLENGE_EXPIRED"
  | "CHANGE_TOO_SOON"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

const STATUS: Record<ProfileErrorCode, 400 | 401 | 404 | 409 | 410 | 429 | 500> = {
  INVALID_REQUEST: 400,
  INVALID_USERNAME: 400,
  INVALID_SIGNATURE: 401,
  PROFILE_NOT_FOUND: 404,
  USERNAME_TAKEN: 409,
  CHALLENGE_EXPIRED: 410,
  CHANGE_TOO_SOON: 429,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export type ProfileRoutesOptions = {
  store: ProfileStore;
  client: Pick<PublicClient, "verifyTypedData" | "verifyMessage">;
  chainId: number;
  challengeTtlSeconds: number;
  /** Minimum time between two username changes of the same wallet (setting it the first time is free). */
  changeCooldownSeconds: number;
  /** Challenges and username changes per IP and per wallet (burst, refill per second). */
  limits?: { ipBurst: number; ipPerSecond: number; walletBurst: number; walletPerSecond: number };
};

const fail = (c: Context, code: ProfileErrorCode, message: string) => c.json({ code, message }, STATUS[code]);

const out = (p: Profile) => ({ wallet: p.wallet, username: p.username, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() });

export function profileRoutes(app: Hono<{ Bindings: { incoming: Parameters<typeof clientIp>[0] } }>, o: ProfileRoutesOptions) {
  // Writes cost a database row and a signature check: their own, stricter limits, per IP and per wallet.
  const l = o.limits ?? { ipBurst: 10, ipPerSecond: 0.2, walletBurst: 5, walletPerSecond: 0.05 };
  const writeIp = new RateLimiter(l.ipBurst, l.ipPerSecond);
  const writeWallet = new RateLimiter(l.walletBurst, l.walletPerSecond);
  const allowed = (c: Context, wallet: Hex) => {
    const ip = c.env?.incoming ? clientIp(c.env.incoming) : "unknown";
    return writeIp.allow(ip) && writeWallet.allow(wallet);
  };

  const guard = (handler: (c: Context) => Promise<Response>) => async (c: Context) => {
    try {
      return await handler(c);
    } catch (e) {
      console.error(`[profiles] ${c.req.method} ${c.req.path}: ${safeError(e)}`);
      return fail(c, "INTERNAL_ERROR", "Something went wrong. Please try again.");
    }
  };

  const readJson = async (c: Context) => {
    try {
      const body = await c.req.json();
      return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };

  // Registered before /:wallet so "by-username" is never read as a wallet.
  app.get(
    "/api/profile/by-username/:username",
    guard(async (c) => {
      const check = checkUsername(c.req.param("username"));
      if (!check.ok) return fail(c, "PROFILE_NOT_FOUND", "No profile with that username.");
      const p = await o.store.byUsername(check.username);
      return p ? c.json(out(p)) : fail(c, "PROFILE_NOT_FOUND", "No profile with that username.");
    }),
  );

  app.get(
    "/api/profile/:wallet",
    guard(async (c) => {
      const wallet = normalizeWallet(c.req.param("wallet"));
      if (!wallet) return fail(c, "INVALID_REQUEST", "Invalid wallet address.");
      const p = await o.store.byWallet(wallet);
      return c.json(p ? out(p) : { wallet, username: null, createdAt: null, updatedAt: null });
    }),
  );

  app.post(
    "/api/profile/challenge",
    guard(async (c) => {
      const body = await readJson(c);
      const wallet = normalizeWallet(body?.wallet);
      if (!wallet) return fail(c, "INVALID_REQUEST", "Invalid wallet address.");
      if (!allowed(c, wallet)) return fail(c, "RATE_LIMITED", "Too many attempts. Please wait a minute.");
      const check = checkUsername(body?.username);
      if (!check.ok) return fail(c, "INVALID_USERNAME", check.message);
      const owner = await o.store.byUsername(check.username);
      if (owner && owner.wallet !== wallet) return fail(c, "USERNAME_TAKEN", "This username is already in use.");

      const ch = await o.store.createChallenge(wallet, check.username, o.challengeTtlSeconds);
      const typed = challengeTypedData(ch, o.chainId);
      return c.json({
        challengeId: ch.id,
        message: challengeMessage(ch, o.chainId),
        typedData: { ...typed, message: { ...typed.message, expires: typed.message.expires.toString() } },
        expiresAt: ch.expiresAt.toISOString(),
      });
    }),
  );

  app.put(
    "/api/profile/username",
    guard(async (c) => {
      const body = await readJson(c);
      const wallet = normalizeWallet(body?.wallet);
      if (!wallet) return fail(c, "INVALID_REQUEST", "Invalid wallet address.");
      if (!allowed(c, wallet)) return fail(c, "RATE_LIMITED", "Too many attempts. Please wait a minute.");
      const check = checkUsername(body?.username);
      if (!check.ok) return fail(c, "INVALID_USERNAME", check.message);
      const challengeId = body?.challengeId;
      const signature = body?.signature;
      if (typeof challengeId !== "string" || !/^[0-9a-f-]{36}$/i.test(challengeId)) return fail(c, "INVALID_REQUEST", "Invalid challengeId.");
      if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) return fail(c, "INVALID_SIGNATURE", "Invalid signature.");

      const ch = await o.store.challenge(challengeId);
      if (!ch || ch.usedAt || ch.expiresAt.getTime() <= Date.now()) return fail(c, "CHALLENGE_EXPIRED", "This challenge has expired or was already used. Request a new one.");
      if (ch.wallet !== wallet || ch.username !== check.username) return fail(c, "INVALID_REQUEST", "Wallet or username does not match the challenge.");
      if (!(await verifyChallengeSignature(o.client, ch, signature as Hex, o.chainId))) {
        return fail(c, "INVALID_SIGNATURE", "The signature does not belong to this wallet.");
      }

      const current = await o.store.byWallet(wallet);
      if (current?.username === check.username) {
        await o.store.consumeChallenge(ch.id);
        return c.json(out(current));
      }
      if (current && Date.now() - current.updatedAt.getTime() < o.changeCooldownSeconds * 1000) {
        const next = new Date(current.updatedAt.getTime() + o.changeCooldownSeconds * 1000);
        return fail(c, "CHANGE_TOO_SOON", `You can change your username again after ${next.toISOString()}.`);
      }
      const taken = await o.store.byUsername(check.username);
      if (taken && taken.wallet !== wallet) return fail(c, "USERNAME_TAKEN", "This username is already in use.");

      // Single use: of two requests with the same challenge, only one gets here.
      if (!(await o.store.consumeChallenge(ch.id))) return fail(c, "CHALLENGE_EXPIRED", "This challenge has expired or was already used. Request a new one.");
      try {
        return c.json(out(await o.store.setUsername(wallet, check.username)));
      } catch (e) {
        if (e instanceof UsernameTaken) return fail(c, "USERNAME_TAKEN", "This username is already in use.");
        throw e;
      }
    }),
  );

  setInterval(() => void o.store.pruneChallenges().catch(() => {}), 10 * 60_000).unref();
}
