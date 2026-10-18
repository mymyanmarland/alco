import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { decryptKey, KeyCryptoError } from "./apikey-crypto";

/**
 * BYO API key resolution. Server-side only — never import from client
 * components. The plaintext key never leaves this module except inside the
 * returned credentials object, which routes pass straight to the AI
 * provider. It is never logged and never sent to the client.
 *
 * Resolution order for AI calls:
 *   1. the user's own stored key (Settings → encrypted at rest)
 *   2. the server-wide AI_API_KEY (fallback)
 *   3. null → routes answer 400 {error:"api_key_missing"}
 */

export const DEFAULT_PROVIDER = "relaymodels";

export interface UserKeyRecord {
  key: string;
  baseUrl: string | null;
}

export interface ResolvedAiCredentials {
  apiKey: string;
  baseUrl: string;
  /** Where the credentials came from — useful for logging, never for UI. */
  source: "user" | "server";
}

export function serverBaseUrl(): string {
  return (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
}

/** Server-wide fallback credentials from env, or null when not configured. */
export function getServerCredentials(): Omit<
  ResolvedAiCredentials,
  "source"
> | null {
  const apiKey = (process.env.AI_API_KEY || "").trim();
  if (!apiKey) return null;
  return { apiKey, baseUrl: serverBaseUrl() };
}

/**
 * Loads and decrypts the user's stored key. Returns null when the user has
 * none, when the server is misconfigured, or when decryption fails (logged
 * server-side without key material — treated as "no usable key").
 */
export async function getUserApiKey(
  userId: string,
): Promise<UserKeyRecord | null> {
  const row = await prisma.userApiKey.findUnique({
    where: { userId_provider: { userId, provider: DEFAULT_PROVIDER } },
    select: { encryptedKey: true, baseUrl: true },
  });
  if (!row) return null;
  try {
    return { key: decryptKey(row.encryptedKey), baseUrl: row.baseUrl };
  } catch (err) {
    // Never throw plaintext; a broken record behaves like no key.
    console.error(
      "[apikeys] failed to decrypt stored key for user",
      err instanceof KeyCryptoError ? err.message : "unknown error",
    );
    return null;
  }
}

/**
 * Full resolution: user key → server fallback → null.
 * Routes call this AFTER auth/ownership/quota checks, BEFORE the provider.
 */
export async function resolveAiCredentials(
  userId: string,
): Promise<ResolvedAiCredentials | null> {
  const userKey = await getUserApiKey(userId);
  if (userKey) {
    return {
      apiKey: userKey.key,
      baseUrl: (userKey.baseUrl || serverBaseUrl()).replace(/\/$/, ""),
      source: "user",
    };
  }
  const server = getServerCredentials();
  if (server) return { ...server, source: "server" };
  return null;
}

/** 400 response shared by /api/chat and /api/builder/* when no key exists. */
export function apiKeyMissingResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "api_key_missing",
      message:
        "No API key is configured. Add your API key in Settings to use AI features.",
    },
    { status: 400 },
  );
}
