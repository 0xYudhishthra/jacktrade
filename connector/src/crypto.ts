import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Agent private keys are stored encrypted with AES-256-GCM under a key derived from SERVER_SECRET.

function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(Buffer.from(secret, "hex")).digest();
}

export function encrypt(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(sealed: string, secret: string): string {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/** Random URL-safe secret. */
export function newSecret(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens are stored hashed, so a database leak does not leak working MCP URLs. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomUint256(): bigint {
  return BigInt("0x" + randomBytes(32).toString("hex"));
}
