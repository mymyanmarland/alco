import { afterEach, describe, expect, it } from "vitest";
import {
  decryptKey,
  encryptKey,
  KeyCryptoError,
  keyHint,
} from "./apikey-crypto";

const KEY = "APP_ENCRYPTION_KEY";
const MASTER_A = "aa".repeat(32);
const MASTER_B = "bb".repeat(32);

function snapshot(): string | undefined {
  return process.env[KEY];
}
function restore(v: string | undefined): void {
  if (v === undefined) delete process.env[KEY];
  else process.env[KEY] = v;
}

describe("apikey-crypto", () => {
  const snap = snapshot();
  afterEach(() => restore(snap));

  it("roundtrips a key through encrypt/decrypt", () => {
    process.env[KEY] = MASTER_A;
    const blob = encryptKey("sk-test-secret-key-12345");
    expect(blob).not.toContain("sk-test-secret-key-12345");
    expect(decryptKey(blob)).toBe("sk-test-secret-key-12345");
  });

  it("produces a different blob each time (random IV)", () => {
    process.env[KEY] = MASTER_A;
    const a = encryptKey("same-key");
    const b = encryptKey("same-key");
    expect(a).not.toBe(b);
    expect(decryptKey(a)).toBe("same-key");
    expect(decryptKey(b)).toBe("same-key");
  });

  it("fails closed when the master key is missing", () => {
    delete process.env[KEY];
    expect(() => encryptKey("x")).toThrow(KeyCryptoError);
    expect(() => decryptKey("eA==")).toThrow(KeyCryptoError);
  });

  it("fails closed when the master key is malformed", () => {
    process.env[KEY] = "too-short";
    expect(() => encryptKey("x")).toThrow(KeyCryptoError);
    process.env[KEY] = "zz".repeat(32); // non-hex
    expect(() => encryptKey("x")).toThrow(KeyCryptoError);
  });

  it("decryption with the wrong master key fails (GCM tag check)", () => {
    process.env[KEY] = MASTER_A;
    const blob = encryptKey("sk-test-secret-key-12345");
    process.env[KEY] = MASTER_B;
    expect(() => decryptKey(blob)).toThrow(KeyCryptoError);
  });

  it("tampered ciphertext fails authentication", () => {
    process.env[KEY] = MASTER_A;
    const blob = encryptKey("sk-test-secret-key-12345");
    const buf = Buffer.from(blob, "base64");
    buf[20] ^= 0xff; // flip a ciphertext byte
    expect(() => decryptKey(buf.toString("base64"))).toThrow(KeyCryptoError);
  });

  it("malformed blobs are rejected without leaking anything", () => {
    process.env[KEY] = MASTER_A;
    expect(() => decryptKey("!!!not-base64!!!")).toThrow(KeyCryptoError);
    expect(() => decryptKey(Buffer.from("short").toString("base64"))).toThrow(
      KeyCryptoError,
    );
    expect(() => decryptKey("")).toThrow(KeyCryptoError);
  });

  it("keyHint exposes only the last 4 chars", () => {
    expect(keyHint("sk-test-secret-key-12345")).toBe("2345");
    expect(keyHint("abc")).toBe("••••");
  });
});
