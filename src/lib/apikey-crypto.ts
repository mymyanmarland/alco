import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for user-supplied (BYO) API keys.
 *
 * Server-side only — never import from client components. The plaintext key
 * must NEVER be logged; errors carry no key material.
 *
 * Wire format (base64): iv (12 bytes) | ciphertext | auth tag (16 bytes).
 * The master key comes from APP_ENCRYPTION_KEY (32-byte hex). A missing or
 * malformed master key throws KeyCryptoError — callers must fail CLOSED
 * (surface 500 {error:"server_misconfigured"}, never attempt decryption).
 */

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export class KeyCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyCryptoError";
  }
}

function masterKey(): Buffer {
  const hex = (process.env.APP_ENCRYPTION_KEY || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new KeyCryptoError(
      "APP_ENCRYPTION_KEY is missing or malformed: it must be a 32-byte hex string. Generate one with: openssl rand -hex 32",
    );
  }
  return Buffer.from(hex, "hex");
}

/** Encrypts a plaintext API key. Throws KeyCryptoError on bad config. */
export function encryptKey(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new KeyCryptoError("Cannot encrypt an empty key.");
  }
  const key = masterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

/**
 * Decrypts a blob produced by encryptKey. Throws KeyCryptoError when the
 * blob is malformed, the master key is wrong, or the data was tampered
 * with (GCM auth-tag verification fails). Never leaks the plaintext.
 */
export function decryptKey(blob: string): string {
  const key = masterKey();
  let buf: Buffer;
  try {
    buf = Buffer.from(blob, "base64");
  } catch {
    throw new KeyCryptoError("Encrypted key blob is not valid base64.");
  }
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new KeyCryptoError("Encrypted key blob is malformed.");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  try {
    const decipher = createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new KeyCryptoError(
      "Could not decrypt the stored API key (wrong APP_ENCRYPTION_KEY or corrupted data).",
    );
  }
}

/** Last 4 chars shown in the UI as a key identifier. Never the full key. */
export function keyHint(plaintext: string): string {
  const trimmed = plaintext.trim();
  return trimmed.length <= 4 ? "••••" : trimmed.slice(-4);
}
