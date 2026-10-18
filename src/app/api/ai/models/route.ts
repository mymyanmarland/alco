import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/get-session";
import {
  defaultLimiter,
  rateLimitKey,
  rateLimitPerMinute,
  rateLimitedResponse,
} from "@/lib/rate-limit";
import { apiKeyMissingResponse, resolveAiCredentials } from "@/lib/apikeys";
import {
  fetchProviderModels,
  ProviderModelsError,
} from "@/lib/provider-models";

/**
 * GET /api/ai/models — the caller's own provider model list (BYO keys).
 *
 * Resolves credentials via resolveAiCredentials(userId) (user key → server
 * fallback) and proxies GET {baseUrl}/models with the key. Returns
 * {models: string[]} — ids only, sorted, capped. The key is never logged
 * and never appears in any response or error.
 */

function fetchFailed(message: string): NextResponse {
  // 502: our server is fine, the upstream provider call failed.
  return NextResponse.json(
    { error: "models_fetch_failed", message },
    { status: 502 },
  );
}

export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = defaultLimiter.check(
    `ai-models:${rateLimitKey(request, userId)}`,
    rateLimitPerMinute(),
    60_000,
  );
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

  const creds = await resolveAiCredentials(userId);
  if (!creds) return apiKeyMissingResponse();

  try {
    const models = await fetchProviderModels(creds);
    return NextResponse.json({ models });
  } catch (err) {
    // Network failure, timeout, or upstream error — never the key.
    return fetchFailed(
      err instanceof ProviderModelsError
        ? err.message
        : "Could not reach the AI provider. Check the Base URL in Settings.",
    );
  }
}
