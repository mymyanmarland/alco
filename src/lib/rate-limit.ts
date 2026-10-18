/**
 * In-memory sliding-window rate limiter (M6-A). Server-side only.
 *
 * Guards /api/auth/*, /api/chat, /api/builder/* and /api/sandbox/run
 * against accidental or abusive bursts. Single-instance only — in
 * production (multi-instance / PM2 cluster) move this to Redis
 * (the same bucket math works with a Redis sorted set).
 */
import { NextResponse } from "next/server";

export type RateLimitVerdict =
  | { ok: true }
  | { ok: false; retryAfterMs: number };

/**
 * Sliding-window limiter with an injectable clock (for deterministic tests).
 * check() is synchronous check+record — atomic in Node's single thread.
 */
export class SlidingWindowLimiter {
  private buckets = new Map<string, number[]>();

  constructor(private now: () => number = () => Date.now()) {}

  check(
    key: string,
    limit: number,
    windowMs: number,
  ): RateLimitVerdict {
    const t = this.now();
    const cutoff = t - windowMs;
    const hits = (this.buckets.get(key) ?? []).filter((h) => h > cutoff);
    if (hits.length >= limit) {
      this.buckets.set(key, hits);
      return { ok: false, retryAfterMs: Math.max(0, hits[0] + windowMs - t) };
    }
    hits.push(t);
    this.buckets.set(key, hits);
    return { ok: true };
  }

  /** For tests: drop all buckets. */
  reset(): void {
    this.buckets.clear();
  }
}

/** Shared singleton used by API routes. */
export const defaultLimiter = new SlidingWindowLimiter();

/** Requests per minute per key. Env override, sane default. */
export function rateLimitPerMinute(): number {
  const raw = Number(process.env.RATE_LIMIT_PER_MINUTE);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 60;
}

/** Stricter cap for auth endpoints (brute-force protection). */
export function authRateLimitPerMinute(): number {
  const raw = Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 20;
}

/**
 * Prefer the authenticated user id as the bucket key; fall back to the
 * client IP for unauthenticated routes (e.g. /api/auth/*).
 */
export function rateLimitKey(req: Request, userId?: string | null): string {
  if (userId) return `user:${userId}`;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  return `ip:${ip}`;
}

/** 429 JSON response with a Retry-After header (seconds). */
export function rateLimitedResponse(retryAfterMs: number): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    { error: "rate_limited", retryAfterMs },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );
}
