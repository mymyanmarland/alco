/**
 * Ephemeral static-preview registry (M5). Server-side only.
 *
 * A successful static run registers its materialized output dir under a
 * cryptographically random token with a TTL (default 15 min, override via
 * SANDBOX_PREVIEW_TTL_MS). The preview route validates token (timing-safe)
 * + TTL before serving any file. Expired entries are swept and their dirs
 * deleted. In-memory for M5 — production (M6) should move this to Redis so
 * previews survive restarts and work across instances.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { LOCAL_SCRATCH_ROOT } from "./local-driver";

interface PreviewEntry {
  dir: string;
  token: Buffer;
  expiresAt: number;
}

const registry = new Map<string, PreviewEntry>();

export function previewTtlMs(): number {
  const raw = Number(process.env.SANDBOX_PREVIEW_TTL_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, 60 * 60_000);
  return 15 * 60_000; // 15 minutes
}

/** Register a materialized dir for preview. Returns the public URL path + token. */
export function registerPreview(runId: string, dir: string): { url: string; token: string; expiresAt: number } {
  const token = randomBytes(32);
  const expiresAt = Date.now() + previewTtlMs();
  registry.set(runId, { dir, token, expiresAt });
  return {
    url: `/api/sandbox/preview/${runId}`,
    token: token.toString("hex"),
    expiresAt,
  };
}

export type PreviewCheck =
  | { ok: true; dir: string }
  | { ok: false; reason: "not_found" | "forbidden" | "expired" };

/** Validate runId + token hex. Returns the dir on success. */
export function checkPreview(runId: string, tokenHex: string): PreviewCheck {
  const entry = registry.get(runId);
  if (!entry) return { ok: false, reason: "not_found" };
  if (Date.now() > entry.expiresAt) {
    void revokePreview(runId);
    return { ok: false, reason: "expired" };
  }
  let presented: Buffer;
  try {
    presented = Buffer.from(tokenHex, "hex");
  } catch {
    return { ok: false, reason: "forbidden" };
  }
  if (presented.length !== entry.token.length || !timingSafeEqual(presented, entry.token)) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, dir: entry.dir };
}

/** Resolve a request path inside the preview dir; rejects traversal. */
export function resolvePreviewPath(dir: string, segments: string[]): string | null {
  const root = path.resolve(dir);
  const target = path.resolve(root, ...segments.map((s) => s.replace(/\\/g, "/")));
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

export async function revokePreview(runId: string): Promise<void> {
  const entry = registry.get(runId);
  if (!entry) return;
  registry.delete(runId);
  const root = path.resolve(LOCAL_SCRATCH_ROOT);
  const dir = path.resolve(entry.dir);
  if (dir !== root && dir.startsWith(root + path.sep)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Periodic sweep of expired previews. Runs once per server instance.
declare global {
  // var is required for global augmentation
  var __alcoPreviewSweeper: ReturnType<typeof setInterval> | undefined;
}
if (!globalThis.__alcoPreviewSweeper) {
  globalThis.__alcoPreviewSweeper = setInterval(() => {
    const now = Date.now();
    for (const [runId, entry] of registry) {
      if (now > entry.expiresAt) void revokePreview(runId);
    }
  }, 60_000);
  globalThis.__alcoPreviewSweeper.unref?.();
}
