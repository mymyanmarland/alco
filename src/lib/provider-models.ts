import { NextResponse } from "next/server";
import { getAvailableModels, getDefaultModel } from "./ai";
import type { ResolvedAiCredentials } from "./apikeys";

/**
 * Provider model listing + per-source model resolution. Server-side only.
 *
 * Context: with BYO keys the chat/builder model selector offers the USER's
 * own provider models (fetched live via GET /api/ai/models), so /api/chat
 * and /api/builder/* must NOT validate the requested model against the
 * server-side AI_MODELS allowlist when the credentials came from the user.
 * Doing so silently fell back to gpt-4o-mini, which RelayModels rejects
 * with 503 "No available channel".
 */

const MODELS_TIMEOUT_MS = 10_000;
const MAX_MODELS = 200;
const CACHE_TTL_MS = 5 * 60_000;

export class ProviderModelsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderModelsError";
  }
}

type Creds = Pick<ResolvedAiCredentials, "apiKey" | "baseUrl">;

/**
 * Fetches GET {baseUrl}/models with the key. Returns ids only —
 * deduped, sorted, capped. Throws ProviderModelsError on any failure.
 * The key is only ever sent in the outbound Authorization header.
 */
export async function fetchProviderModels(creds: Creds): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS);
  try {
    const res = await fetch(`${creds.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${creds.apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new ProviderModelsError(
        `The AI provider returned HTTP ${res.status}. Check the Base URL and API key in Settings.`,
      );
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new ProviderModelsError(
        "The AI provider returned an unreadable model list. Check the Base URL in Settings.",
      );
    }
    const raw =
      typeof data === "object" && data !== null
        ? ((data as { data?: unknown }).data ??
          (data as { models?: unknown }).models)
        : null;
    const ids = new Set<string>();
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const id =
          typeof item === "string"
            ? item
            : typeof item === "object" && item !== null
              ? (item as { id?: unknown }).id
              : null;
        if (typeof id === "string" && id.length > 0) ids.add(id);
      }
    }
    return [...ids].sort().slice(0, MAX_MODELS);
  } catch (err) {
    if (err instanceof ProviderModelsError) throw err;
    // Network failure or timeout — never include the key or its hint.
    throw new ProviderModelsError(
      "Could not reach the AI provider. Check the Base URL in Settings.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

// --- 5-minute in-memory cache, keyed by user + credential identity ---

function cacheKey(userId: string, creds: Creds): string {
  // FNV-1a over the credential identity: cache-busting only. The map key
  // holds the hash, never key material.
  let h = 0x811c9dc5;
  const s = `${userId}|${creds.baseUrl}|${creds.apiKey}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${userId}:${(h >>> 0).toString(16)}`;
}

const cache = new Map<string, { models: string[]; expiresAt: number }>();

/** Cached wrapper around fetchProviderModels (5-min TTL per user+key). */
export async function getCachedProviderModels(
  userId: string,
  creds: Creds,
): Promise<string[]> {
  const key = cacheKey(userId, creds);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.models;
  const models = await fetchProviderModels(creds);
  cache.set(key, { models, expiresAt: Date.now() + CACHE_TTL_MS });
  return models;
}

/** Test hook — clears the in-memory cache. */
export function __clearProviderModelsCache(): void {
  cache.clear();
}

// --- model id sanity check ---

// Letters, digits, and the separators real providers use
// (claude-opus-5, gemini-3.8-flash, openai/gpt-4o-mini). The ".." rejection
// is defense-in-depth: the id is only ever sent to the provider as a JSON
// string, but a traversal-looking id is never legitimate.
const SAFE_MODEL_RE = /^[A-Za-z0-9._:/-]{1,100}$/;

export function isSafeModelId(s: string): boolean {
  return SAFE_MODEL_RE.test(s) && !s.includes("..");
}

export function invalidModelResponse(): NextResponse {
  return NextResponse.json(
    { error: "invalid_model", message: "Select a model from the list." },
    { status: 400 },
  );
}

// --- per-source resolution ---

export type ModelResolution =
  | { ok: true; model: string }
  | { ok: false; response: NextResponse };

/**
 * Resolves which model id the provider call should use.
 *
 * - source "server": EXACT legacy behavior — allowlist against
 *   getAvailableModels(), unknown/missing → getDefaultModel().
 * - source "user": the selector already offered this user's live provider
 *   list, so a safe requested id is used as-is (no server allowlist).
 *   Missing/unsafe id → first model of the cached provider list.
 *   If that fetch fails or is empty → 400 invalid_model.
 */
export async function resolveRequestModel(
  userId: string,
  creds: ResolvedAiCredentials,
  requestedRaw: unknown,
): Promise<ModelResolution> {
  const requested =
    typeof requestedRaw === "string" && requestedRaw.trim()
      ? requestedRaw.trim()
      : null;

  if (creds.source === "server") {
    const models = getAvailableModels();
    const fallback = requested ?? getDefaultModel();
    return {
      ok: true,
      model: models.includes(fallback) ? fallback : getDefaultModel(),
    };
  }

  if (requested && isSafeModelId(requested)) {
    return { ok: true, model: requested };
  }
  try {
    const models = await getCachedProviderModels(userId, creds);
    if (models.length > 0) return { ok: true, model: models[0] };
  } catch {
    // fall through to invalid_model
  }
  return { ok: false, response: invalidModelResponse() };
}
