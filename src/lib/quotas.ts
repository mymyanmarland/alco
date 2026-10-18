/**
 * Unified quota enforcement (M6-A). Server-side only.
 *
 * - AI tokens: per-user DAILY cap from usage_events (kind="ai_tokens").
 *   Checked BEFORE expensive work in /api/chat and /api/builder/*.
 * - Sandbox minutes: reuses src/lib/sandbox/quotas.ts (concurrency +
 *   daily budget) — this module is the single entry point for both.
 *
 * 429 responses use { error: "quota_exceeded", resetAt } so clients can
 * show a bilingual-friendly message and retry after midnight.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkDailyBudget as checkSandboxDailyBudget } from "@/lib/sandbox/quotas";

export type QuotaVerdict =
  | { ok: true }
  | {
      ok: false;
      code: "quota_exceeded";
      limit: number;
      used: number;
      resetAt: string;
    };

/** Daily AI token cap per user. Env override, sane default. */
export function aiTokensDailyCap(): number {
  return parsePositiveInt(process.env.AI_TOKENS_DAILY_CAP, 200_000);
}

/** Daily sandbox execution cap in MINUTES per user (mirrors sandbox quotas). */
export function sandboxMinutesDailyCap(): number {
  return parsePositiveInt(process.env.SANDBOX_MINUTES_DAILY_CAP, 10);
}

/** Parse a positive int env var with a default. Pure — unit tested. */
export function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  const n = Number(raw);
  if (raw !== undefined && raw !== "" && Number.isFinite(n) && n > 0) {
    return Math.floor(n);
  }
  return fallback;
}

/** Start of the current local day. */
export function startOfToday(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** ISO timestamp of the next local midnight (when quotas reset). */
export function quotaResetAt(from: Date = new Date()): string {
  const d = new Date(from);
  d.setHours(24, 0, 0, 0);
  return d.toISOString();
}

/** Pure sum helper (null-safe) for aggregate rows. Unit tested. */
export function sumQuantities(
  values: (number | null | undefined)[],
): number {
  let total = 0;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return total;
}

/** AI tokens consumed by a user since local midnight. */
export async function aiTokensUsedToday(userId: string): Promise<number> {
  const agg = await prisma.usageEvent.aggregate({
    _sum: { quantity: true },
    where: {
      userId,
      kind: "ai_tokens",
      createdAt: { gte: startOfToday() },
    },
  });
  return sumQuantities([agg._sum.quantity]);
}

/** Guard for /api/chat and /api/builder/*. Call BEFORE the provider call. */
export async function checkAiTokenQuota(
  userId: string,
): Promise<QuotaVerdict> {
  const limit = aiTokensDailyCap();
  const used = await aiTokensUsedToday(userId);
  if (used >= limit) {
    return {
      ok: false,
      code: "quota_exceeded",
      limit,
      used,
      resetAt: quotaResetAt(),
    };
  }
  return { ok: true };
}

/** Sandbox daily-minutes guard, unified entry point (delegates to M5 module). */
export async function checkSandboxQuota(
  userId: string,
): Promise<QuotaVerdict> {
  const verdict = await checkSandboxDailyBudget(userId);
  if (verdict.ok) return { ok: true };
  const limit = sandboxMinutesDailyCap() * 60_000;
  return {
    ok: false,
    code: "quota_exceeded",
    limit,
    used: limit,
    resetAt: quotaResetAt(),
  };
}

/** Build the standard 429 JSON response for a failed quota check. */
export function quotaExceededResponse(
  verdict: Extract<QuotaVerdict, { ok: false }>,
): NextResponse {
  return NextResponse.json(
    {
      error: "quota_exceeded",
      limit: verdict.limit,
      used: verdict.used,
      resetAt: verdict.resetAt,
    },
    { status: 429 },
  );
}
