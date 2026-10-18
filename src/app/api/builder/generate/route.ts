import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AIProviderError,
  getProvider,
  getTimeoutMs,
  type ChatMessage,
} from "@/lib/ai";
import { requireOwnedProject } from "@/lib/builder/guard";
import {
  defaultLimiter,
  rateLimitKey,
  rateLimitPerMinute,
  rateLimitedResponse,
} from "@/lib/rate-limit";
import { checkAiTokenQuota, quotaExceededResponse } from "@/lib/quotas";
import { apiKeyMissingResponse, resolveAiCredentials } from "@/lib/apikeys";
import { resolveRequestModel } from "@/lib/provider-models";
import {
  generateSystemPrompt,
  parseFileBlocks,
  type BuildPlan,
} from "@/lib/builder/prompts";
import { sseEncode, sseHeaders, type BuilderEvent } from "@/lib/builder/sse";
import {
  commitAll,
  ensureRepo,
  MAX_FILES_PER_PROJECT,
  StorageError,
  validateFilePath,
  writeProjectFile,
} from "@/lib/builder/storage";
import { syncProjectFiles } from "@/lib/builder/sync";

function isValidPlan(p: unknown): p is BuildPlan {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  if (!Array.isArray(o.files) || o.files.length === 0) return false;
  if (o.files.length > MAX_FILES_PER_PROJECT) return false;
  return (o.files as unknown[]).every(
    (f) =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as Record<string, unknown>).path === "string",
  );
}

/**
 * POST /api/builder/generate — { projectId, plan, model?, prompt? }.
 * Generates each planned file sequentially, writes to the git repo,
 * commits once. Streams per-file progress events.
 */
export async function POST(request: Request) {
  let body: {
    projectId?: unknown;
    plan?: unknown;
    model?: unknown;
    prompt?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const guard = await requireOwnedProject(body.projectId);
  if ("response" in guard) return guard.response;
  const { userId, project } = guard;

  // M6-A: rate limit + daily AI token quota BEFORE the provider calls.
  const rl = defaultLimiter.check(
    `builder:generate:${rateLimitKey(request, userId)}`,
    rateLimitPerMinute(),
    60_000,
  );
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);
  const quota = await checkAiTokenQuota(userId);
  if (!quota.ok) return quotaExceededResponse(quota);

  // BYO keys: user key → server AI_API_KEY fallback → 400 api_key_missing.
  const creds = await resolveAiCredentials(userId);
  if (!creds) return apiKeyMissingResponse();

  if (!isValidPlan(body.plan)) {
    return NextResponse.json(
      { error: `Plan must include 1-${MAX_FILES_PER_PROJECT} files` },
      { status: 400 },
    );
  }
  const plan = body.plan;
  const promptSummary =
    typeof body.prompt === "string" && body.prompt.trim()
      ? body.prompt.trim().slice(0, 120)
      : `${plan.files.length} files`;

  const modelResolution = await resolveRequestModel(userId, creds, body.model);
  if (!modelResolution.ok) return modelResolution.response;
  const model = modelResolution.model;

  const provider = getProvider();
  const timeoutMs = getTimeoutMs();
  const aborted = { value: false };
  request.signal.addEventListener("abort", () => {
    aborted.value = true;
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: BuilderEvent) => {
        try {
          controller.enqueue(sseEncode(e));
        } catch {
          // client disconnected
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      let repo: string;
      try {
        repo = await ensureRepo(project.id);
      } catch (err) {
        send({
          type: "error",
          code: "storage",
          message:
            err instanceof StorageError
              ? err.message
              : "Could not prepare project storage.",
        });
        close();
        return;
      }

      const generated: { path: string; bytes: number }[] = [];
      const generatedPaths: string[] = [];
      let totalChars = 0;

      for (const file of plan.files) {
        if (aborted.value) {
          send({ type: "error", code: "aborted", message: "Aborted" });
          close();
          return;
        }
        const requestedPath = (file as { path: string }).path;
        send({ type: "file", path: requestedPath, status: "started" });

        // Validate the planned path BEFORE spending model tokens on it.
        let safePath: string;
        try {
          safePath = validateFilePath(requestedPath);
        } catch (err) {
          send({
            type: "file",
            path: requestedPath,
            status: "error",
            message:
              err instanceof StorageError ? err.message : "Invalid file path",
          });
          send({
            type: "error",
            code: "invalid_path",
            message: `Refusing to generate unsafe path: ${requestedPath}`,
          });
          close();
          return;
        }

        const messages: ChatMessage[] = [
          {
            role: "system",
            content: generateSystemPrompt(plan, generatedPaths),
          },
          { role: "user", content: `REQUESTED FILE: ${safePath}` },
        ];

        let fullText = "";
        try {
          for await (const chunk of provider.streamChat(messages, {
            model,
            timeoutMs,
            signal: request.signal,
            credentials: { apiKey: creds.apiKey, baseUrl: creds.baseUrl },
          })) {
            if (aborted.value) break;
            fullText += chunk;
          }
        } catch (err) {
          const code =
            err instanceof AIProviderError ? err.code : "provider";
          const message =
            err instanceof AIProviderError
              ? err.message
              : "Code generation failed.";
          send({ type: "file", path: safePath, status: "error", message });
          send({ type: "error", code, message });
          close();
          return;
        }
        if (aborted.value) {
          send({ type: "error", code: "aborted", message: "Aborted" });
          close();
          return;
        }

        totalChars += fullText.length;
        const blocks = parseFileBlocks(fullText);
        const match =
          blocks.find((b) => b.path === safePath) ?? blocks[0] ?? null;
        if (!match || match.path !== safePath) {
          send({
            type: "file",
            path: safePath,
            status: "error",
            message: "The AI did not return the requested file.",
          });
          send({
            type: "error",
            code: "invalid_file",
            message: `No valid content returned for ${safePath}. Nothing was committed.`,
          });
          close();
          return;
        }

        try {
          const bytes = await writeProjectFile(repo, safePath, match.content);
          generated.push({ path: safePath, bytes });
          generatedPaths.push(safePath);
          send({ type: "file", path: safePath, status: "done", bytes });
        } catch (err) {
          const message =
            err instanceof StorageError ? err.message : "Write failed.";
          send({ type: "file", path: safePath, status: "error", message });
          send({ type: "error", code: "storage", message });
          close();
          return;
        }
      }

      // Commit once after all files succeed.
      let commitSha: string | null = null;
      try {
        commitSha = await commitAll(repo, `Generate: ${promptSummary}`);
        const tracked = await syncProjectFiles(project.id, repo);
        if (commitSha) {
          await prisma.projectVersion.create({
            data: {
              projectId: project.id,
              message: `Generate: ${promptSummary}`,
              snapshotRef: commitSha,
            },
          });
        }
        await prisma.project.update({
          where: { id: project.id },
          data: { updatedAt: new Date() },
        });
        const usage = provider.lastUsage;
        await prisma.usageEvent.create({
          data: {
            userId,
            kind: "ai_tokens",
            quantity:
              (usage?.promptTokens ?? 0) +
              (usage?.completionTokens ??
                Math.max(1, Math.ceil(totalChars / 4))),
            model,
          },
        });
        void tracked;
      } catch (err) {
        send({
          type: "error",
          code: "storage",
          message:
            err instanceof Error
              ? `Commit failed: ${err.message}`
              : "Commit failed.",
        });
        close();
        return;
      }

      send({ type: "done", commitSha, files: generated });
      close();
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
