/**
 * Sandbox quotas (M5). Server-side only.
 *
 * - Max 2 concurrent runs per user (in-memory semaphore).
 * - 10-minute daily execution budget per user (from sandbox_runs durations).
 * - Per-run timeout hard cap 180s (enforced by drivers via RUN_LIMITS).
 *
 * The in-memory semaphore is fine for a single instance (M5). Production
 * (M6) should move the semaphore to Redis for multi-instance correctness.
 */
import { prisma } from "@/lib/prisma";
import { RUN_LIMITS } from "./types";

const active = new Map<string, number>();

export type QuotaCheck = { ok: true } | { ok: false; code: string; message: string };

/**
 * Atomically take a concurrency slot. Synchronous check+increment is atomic
 * in Node's single thread — no TOCTOU race between concurrent requests.
 * Returns false when the user is already at the concurrency cap.
 */
export function tryAcquireSlot(userId: string): boolean {
  const running = active.get(userId) ?? 0;
  if (running >= RUN_LIMITS.maxConcurrentPerUser) return false;
  active.set(userId, running + 1);
  return true;
}

export function releaseSlot(userId: string): void {
  const n = (active.get(userId) ?? 1) - 1;
  if (n <= 0) active.delete(userId);
  else active.set(userId, n);
}

/** Daily execution budget check (async DB aggregate). Call AFTER tryAcquireSlot. */
export async function checkDailyBudget(userId: string): Promise<QuotaCheck> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const agg = await prisma.sandboxRun.aggregate({
    _sum: { durationMs: true },
    where: { userId, createdAt: { gte: startOfDay } },
  });
  const used = agg._sum.durationMs ?? 0;
  if (used >= RUN_LIMITS.dailyExecutionMs) {
    return {
      ok: false,
      code: "daily_limit",
      message:
        "Daily sandbox execution budget (10 minutes) exhausted. Try again tomorrow.",
    };
  }
  return { ok: true };
}

/** Remaining daily budget in ms (for UI display). */
export async function dailyRemainingMs(userId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const agg = await prisma.sandboxRun.aggregate({
    _sum: { durationMs: true },
    where: { userId, createdAt: { gte: startOfDay } },
  });
  return Math.max(0, RUN_LIMITS.dailyExecutionMs - (agg._sum.durationMs ?? 0));
}
