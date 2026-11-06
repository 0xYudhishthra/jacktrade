import { getAddress, isAddress, isHex, recoverMessageAddress, recoverTypedDataAddress, type Hex, type PublicClient } from "viem";

/**
 * Wallet-linked public profiles: rules, signed challenge format and signature verification.
 * Pure logic (no database, no HTTP) so it can be tested on its own.
 */

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,23}$/;

/** System names, brand names and anything that could pass for an official account. */
export const RESERVED = new Set([
  "admin", "administrator", "root", "system", "support", "help", "helpdesk", "staff", "team", "official", "mod", "moderator",
  "security", "abuse", "api", "app", "www", "mail", "status", "docs", "blog", "news", "about", "terms", "privacy", "legal",
  "settings", "profile", "profiles", "user", "users", "u", "me", "account", "wallet", "login", "logout", "signup", "register",
  "null", "undefined", "anonymous", "unknown", "test", "owner", "guardian", "relayer", "keeper", "keepers", "liquidator",
  "indexer", "oracle", "pyth", "exchange", "house", "thehouse", "jacktrade", "jack.trade", "jack-trade", "jack_trade",
  "jacktradeexchange", "jt", "hm", "hmx", "robinhood", "usdg", "bot", "bots",
]);

export type UsernameCheck = { ok: true; username: string } | { ok: false; message: string };

/** Normalizes (lowercase, trimmed) and validates a username. Comparisons are case-insensitive. */
export function checkUsername(raw: unknown): UsernameCheck {
  if (typeof raw !== "string") return { ok: false, message: "Username must be a string." };
  const username = raw.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return { ok: false, message: "Username must be 3-24 characters: lowercase letters, numbers, dot, hyphen or underscore, starting with a letter or number." };
  }
  if (RESERVED.has(username) || /^jack[._-]?trade/.test(username)) return { ok: false, message: "This username is reserved." };
  // Something that looks like an address could be used to impersonate another wallet.
  if (/^0x[0-9a-f]{4,}$/.test(username)) return { ok: false, message: "Usernames cannot look like a wallet address." };
  return { ok: true, username };
}

/** Lowercase address, or undefined if it is not an address. */
export function normalizeWallet(raw: unknown): Hex | undefined {
  if (typeof raw !== "string" || !isAddress(raw, { strict: false })) return undefined;
  return getAddress(raw).toLowerCase() as Hex;
}

// ---------------------------------------------------------------- what the wallet signs

export const PROFILE_DOMAIN = (chainId: number) => ({ name: "JackTrade Profile", version: "1", chainId }) as const;

export const PROFILE_TYPES = {
  SetUsername: [
    { name: "wallet", type: "address" },
    { name: "username", type: "string" },
    { name: "nonce", type: "bytes32" },
    { name: "expires", type: "uint256" },
  ],
} as const;

export type Challenge = { wallet: Hex; username: string; nonce: Hex; expiresAt: Date };

/** EIP-712 typed data for `eth_signTypedData_v4` (preferred). */
export function challengeTypedData(c: Challenge, chainId: number) {
  return {
    domain: PROFILE_DOMAIN(chainId),
    types: PROFILE_TYPES,
    primaryType: "SetUsername" as const,
    message: { wallet: getAddress(c.wallet), username: c.username, nonce: c.nonce, expires: BigInt(Math.floor(c.expiresAt.getTime() / 1000)) },
  };
}

/** Plain-text version for `personal_sign` (EIP-191), for wallets that cannot sign typed data. */
export function challengeMessage(c: Challenge, chainId: number) {
  return [
    "JACKTRADE profile",
    `Wallet: ${getAddress(c.wallet)}`,
    `Username: ${c.username}`,
    `Nonce: ${c.nonce}`,
    `Expires: ${c.expiresAt.toISOString()}`,
    `Chain ID: ${chainId}`,
  ].join("\n");
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Does `signature` prove control of `challenge.wallet`? Accepts EIP-712 (typed data) or EIP-191 (the plain message), from:
 * - an EOA: the recovered signer is the wallet;
 * - a smart wallet: ERC-1271 `isValidSignature` on the wallet contract (viem also covers ERC-6492 counterfactual wallets);
 * - an EOA with an EIP-7702 delegation: its own key still controls it, so a direct recovery is accepted too.
 */
export async function verifyChallengeSignature(client: Pick<PublicClient, "verifyTypedData" | "verifyMessage">, c: Challenge, signature: Hex, chainId: number) {
  // 65-byte signatures and longer smart-wallet ones (ERC-1271 / ERC-6492), up to a sane cap.
  if (!isHex(signature) || signature.length < 132 || signature.length > 16_384) return false;
  const typed = challengeTypedData(c, chainId);
  const message = challengeMessage(c, chainId);

  for (const recover of [() => recoverTypedDataAddress({ ...typed, signature }), () => recoverMessageAddress({ message, signature })]) {
    try {
      if (sameAddress(await recover(), c.wallet)) return true;
    } catch {
      // not a plain 65-byte signature (e.g. a smart wallet's): try ERC-1271 below
    }
  }
  for (const verify of [
    () => client.verifyTypedData({ address: c.wallet, ...typed, signature }),
    () => client.verifyMessage({ address: c.wallet, message, signature }),
  ]) {
    try {
      if (await verify()) return true;
    } catch {
      // the wallet rejected it or the call failed: not valid
    }
  }
  return false;
}
