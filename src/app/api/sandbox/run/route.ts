/**
 * POST /api/sandbox/run — execute a project's code in the sandbox.
 * Streams SSE: run → step/log events → done | error.
 * Persists a sandbox_runs row. Static successes get a preview URL.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/get-session";
import { requireOwnedProject } from "@/lib/builder/guard";
import { sseEncodeJson, sseHeaders } from "@/lib/builder/sse";
import { getSandboxDriver } from "@/lib/sandbox";
import {
  cleanupWorktree,
  detectProjectType,
  materializeWorktree,
  runSteps,
  type StepLog,
} from "@/lib/sandbox/runner";
import { RUN_LIMITS } from "@/lib/sandbox/types";
import { checkDailyBudget, releaseSlot, tryAcquireSlot } from "@/lib/sandbox/quotas";
import {
  defaultLimiter,
  rateLimitKey,
  rateLimitPerMinute,
  rateLimitedResponse,
} from "@/lib/rate-limit";
import { registerPreview } from "@/lib/sandbox/preview";
import { StorageError } from "@/lib/builder/storage";

export const maxDuration = 300; // route-level ceiling (VPS); driver caps runs at 180s

const LOG_PERSIST_CAP = 64 * 1024;
const ALLOWED_STEPS = new Set(["install", "build", "package"]);

type SandboxEvent =
  | { type: "run"; runId: string; sha: string; projectType: string; driver: string }
  | { type: "step"; step: string; status: "started" | "done"; exitCode?: number; timedOut?: boolean; durationMs?: number }
  | { type: "log"; step: string; stream: "stdout" | "stderr"; text: string }
  | {
      type: "done";
      status: "succeeded" | "failed" | "timeout";
      durationMs: number;
      previewUrl?: string;
      previewExpiresAt?: number;
    }
  | { type: "error"; code: string; message: string };

export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { projectId?: unknown; snapshotRef?: unknown; steps?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const guard = await requireOwnedProject(body.projectId);
  if ("response" in guard) return guard.response;
  const { project } = guard;

  // M6-A: rate limit before the concurrency slot / budget checks.
  const rl = defaultLimiter.check(
    `sandbox:${rateLimitKey(req, userId)}`,
    rateLimitPerMinute(),
    60_000,
  );
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

  let onlySteps: string[] | undefined;
  if (body.steps !== undefined) {
    if (
      !Array.isArray(body.steps) ||
      body.steps.some((s) => typeof s !== "string" || !ALLOWED_STEPS.has(s))
    ) {
      return NextResponse.json(
        { error: "steps must be a subset of [install, build, package]" },
        { status: 400 },
      );
    }
    onlySteps = body.steps as string[];
  }
  const snapshotRef =
    body.snapshotRef === undefined || body.snapshotRef === null
      ? undefined
      : String(body.snapshotRef);

  // Atomic slot first (sync check+increment — no TOCTOU race), then daily budget.
  if (!tryAcquireSlot(userId)) {
    return NextResponse.json(
      {
        error: `Too many concurrent runs (max ${RUN_LIMITS.maxConcurrentPerUser}). Wait for one to finish.`,
      },
      { status: 429 },
    );
  }
  const daily = await checkDailyBudget(userId).catch(() => ({ ok: true }) as const);
  if (!daily.ok) {
    releaseSlot(userId);
    return NextResponse.json({ error: daily.message }, { status: 429 });
  }

  const driver = getSandboxDriver();
  const startedAt = Date.now();

  // Row first (status running) so history shows in-flight runs.
  const row = await prisma.sandboxRun.create({
    data: {
      userId,
      projectId: project.id,
      runtime: "sandbox",
      status: "running",
      driver: driver.name,
      snapshotRef: snapshotRef ?? null,
    },
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: SandboxEvent) => controller.enqueue(sseEncodeJson(e));
      const finish = () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const failRow = async (message: string) => {
        await prisma.sandboxRun
          .update({
            where: { id: row.id },
            data: {
              status: "failed",
              durationMs: Date.now() - startedAt,
              stderr: message.slice(0, LOG_PERSIST_CAP),
            },
          })
          .catch(() => undefined);
      };
      try {
        // Materialize first so the "run" event precedes step events.
        let dir: string;
        let sha: string;
        try {
          ({ dir, sha } = await materializeWorktree(project.id, snapshotRef));
        } catch (err) {
          const code = err instanceof StorageError ? "bad_request" : "run_failed";
          send({
            type: "error",
            code,
            message: err instanceof Error ? err.message : "Sandbox run failed",
          });
          await failRow(err instanceof Error ? err.message : "failed");
          finish();
          return;
        }
        let projectType: "node" | "static";
        try {
          projectType = await detectProjectType(dir);
        } catch (err) {
          send({
            type: "error",
            code: "bad_request",
            message: err instanceof Error ? err.message : "Unsupported project",
          });
          await failRow(err instanceof Error ? err.message : "failed");
          await cleanupWorktree(dir);
          finish();
          return;
        }

        send({ type: "run", runId: row.id, sha, projectType, driver: driver.name });

        const hooks = {
          onStepStart: (step: { name: string }) =>
            send({ type: "step", step: step.name, status: "started" as const }),
          onOutput: (step: string, s: "stdout" | "stderr", chunk: string) =>
            send({ type: "log", step, stream: s, text: chunk.slice(0, 8000) }),
          onStepDone: (log: StepLog) =>
            send({
              type: "step",
              step: log.name,
              status: "done" as const,
              exitCode: log.exitCode,
              timedOut: log.timedOut,
              durationMs: log.durationMs,
            }),
        };
        const { steps, succeeded, timedOut } = await runSteps(
          dir,
          projectType,
          driver,
          hooks,
          row.id,
          onlySteps,
        );

        const status: "succeeded" | "failed" | "timeout" = timedOut
          ? "timeout"
          : succeeded
            ? "succeeded"
            : "failed";
        const durationMs = Date.now() - startedAt;
        const stdout = steps
          .map((s) => s.stdout)
          .join("\n")
          .slice(0, LOG_PERSIST_CAP);
        const stderr = steps
          .map((s) => s.stderr)
          .join("\n")
          .slice(0, LOG_PERSIST_CAP);
        const exitCode =
          steps.length > 0 ? steps[steps.length - 1].exitCode : null;

        let previewUrl: string | undefined;
        let previewExpiresAt: number | undefined;
        if (succeeded && projectType === "static") {
          // The preview registry takes ownership of outputDir (no cleanup).
          const prev = registerPreview(row.id, dir);
          previewUrl = `${prev.url}?token=${prev.token}`;
          previewExpiresAt = prev.expiresAt;
        } else {
          await cleanupWorktree(dir);
        }

        await prisma.sandboxRun.update({
          where: { id: row.id },
          data: { status, exitCode, durationMs, stdout, stderr, snapshotRef: sha },
        });

        send({ type: "done", status, durationMs, previewUrl, previewExpiresAt });
        finish();
      } catch (err) {
        try {
          send({
            type: "error",
            code: "run_failed",
            message: err instanceof Error ? err.message : "Sandbox run failed",
          });
        } catch {
          // stream already gone
        }
        await prisma.sandboxRun
          .update({
            where: { id: row.id },
            data: { status: "failed", durationMs: Date.now() - startedAt },
          })
          .catch(() => undefined);
        finish();
      } finally {
        releaseSlot(userId);
      }
    },
    cancel() {
      releaseSlot(userId);
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
