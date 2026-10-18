import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import type { NextRequest } from "next/server";
import {
  authRateLimitPerMinute,
  defaultLimiter,
  rateLimitKey,
  rateLimitedResponse,
} from "@/lib/rate-limit";

const handlers = toNextJsHandler(auth);

type AuthHandler = (req: NextRequest) => Promise<Response> | Response;

/**
 * M6-A: brute-force protection on auth endpoints (per-IP sliding window).
 * Unauthenticated here, so the bucket key falls back to the client IP.
 */
function withAuthLimit(handler: AuthHandler): AuthHandler {
  return (req: NextRequest) => {
    const verdict = defaultLimiter.check(
      `auth:${rateLimitKey(req)}`,
      authRateLimitPerMinute(),
      60_000,
    );
    if (!verdict.ok) return rateLimitedResponse(verdict.retryAfterMs);
    return handler(req);
  };
}

export const GET = withAuthLimit(handlers.GET);
export const POST = withAuthLimit(handlers.POST);
