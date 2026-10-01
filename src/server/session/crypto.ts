import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { getEnv } from "@/config/env";

/**
 * Symmetric crypto helpers for the BFF.
 *
 * Separate 256-bit keys are derived from SESSION_SECRET with HKDF, one per purpose,
 * so a value encrypted for one purpose (e.g. the login-transaction cookie) can never
 * be replayed as another (e.g. stored tokens). AES-256-GCM provides confidentiality
 * and integrity.
 */

export type KeyPurpose = "tokens" | "login-transaction";

const keyCache = new Map<KeyPurpose, Buffer>();

export class SessionSecretMissingError extends Error {
  constructor() {
    super("SESSION_SECRET is not set (min 32 chars). See .env.example.");
    this.name = "SessionSecretMissingError";
  }
}

function key(purpose: KeyPurpose): Buffer {
  let k = keyCache.get(purpose);
  if (!k) {
    const secret = getEnv().SESSION_SECRET;
    if (!secret) throw new SessionSecretMissingError();
    k = Buffer.from(hkdfSync("sha256", secret, "trust-guard", `trust-guard:${purpose}`, 32));
    keyCache.set(purpose, k);
  }
  return k;
}

/** Encrypt a UTF-8 string. Output: base64url(iv | tag | ciphertext). */
export function encrypt(plaintext: string, purpose: KeyPurpose): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

/** Decrypt a value produced by `encrypt`. Returns `null` if it was tampered with. */
export function decrypt(payload: string, purpose: KeyPurpose): string | null {
  try {
    const buf = Buffer.from(payload, "base64url");
    if (buf.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(purpose), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** A new random, URL-safe session identifier (256 bits). */
export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/** The session id is only ever stored hashed. */
export function hashSessionId(id: string): Buffer {
  return createHash("sha256").update(id).digest();
}
