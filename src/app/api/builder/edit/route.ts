import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AIProviderError,
  estimateTokens,
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
import { editSystemPrompt, parseFileBlocks } from "@/lib/builder/prompts";
import { sseEncode, sseHeaders, type BuilderEvent } from "@/lib/builder/sse";
import {
  commitAll,
  ensureRepo,
  listTrackedFiles,
  MAX_FILES_PER_PROJECT,
  readProjectFile,
  StorageError,
  validateFilePath,
  writeProjectFile,
} from "@/lib/builder/storage";
import { syncProjectFiles } from "@/lib/builder/sync";

const MAX_INSTRUCTION_LEN = 4000;
const MAX_CONTEXT_FILES = 50;

/**
 * POST /api/builder/edit — { projectId, instruction, targetPaths?, model? }.
 * Rewrites ONLY the files the model returns; everything else is preserved
 * byte-for-byte. Commits the result as a new version.
 */
export async function POST(request: Request) {
  let body: {
    projectId?: unknown;
    instruction?: unknown;
    targetPaths?: unknown;
    model?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const guard = await requireOwnedProject(body.projectId);
  if ("response" in guard) return guard.response;
  const { userId, project } = guard;

  // M6-A: rate limit + daily AI token quota BEFORE the provider call.
  const rl = defaultLimiter.check(
    `builder:edit:${rateLimitKey(request, userId)}`,
    rateLimitPerMinute(),
    60_000,
  );
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);
  const quota = await checkAiTokenQuota(userId);
  if (!quota.ok) return quotaExceededResponse(quota);

  // BYO keys: user key → server AI_API_KEY fallback → 400 api_key_missing.
  const creds = await resolveAiCredentials(userId);
  if (!creds) return apiKeyMissingResponse();

  const instruction =
    typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction || instruction.length > MAX_INSTRUCTION_LEN) {
    return NextResponse.json(
      { error: "Instruction is required (max 4000 chars)" },
      { status: 400 },
    );
  }

  let targetPaths: string[] | null = null;
  if (body.targetPaths !== undefined) {
    if (
      !Array.isArray(body.targetPaths) ||
      body.targetPaths.length === 0 ||
      body.targetPaths.length > MAX_FILES_PER_PROJECT ||
      !body.targetPaths.every((p) => typeof p === "string")
    ) {
      return NextResponse.json(
        { error: "targetPaths must be a non-empty array of paths" },
        { status: 400 },
      );
    }
    try {
      targetPaths = (body.targetPaths as string[]).map(validateFilePath);
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof StorageError ? err.message : "Invalid target path",
        },
        { status: 400 },
      );
    }
  }

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

      // Load current file contents as edit context.
      let paths: string[];
      try {
        const tracked = await listTrackedFiles(repo);
        paths = targetPaths ?? tracked.map((f) => f.path);
        if (paths.length === 0) {
          send({
            type: "error",
            code: "no_files",
            message: "This project has no files yet — generate first.",
          });
          close();
          return;
        }
        if (paths.length > MAX_CONTEXT_FILES && !targetPaths) {
          send({
            type: "error",
            code: "too_many_files",
            message: `Project has ${paths.length} files; specify targetPaths for edits.`,
          });
          close();
          return;
        }
      } catch (err) {
        send({
          type: "error",
          code: "storage",
          message: err instanceof Error ? err.message : "Read failed.",
        });
        close();
        return;
      }

      const contextFiles: { path: string; content: string }[] = [];
      for (const p of paths) {
        try {
          contextFiles.push({
            path: p,
            content: await readProjectFile(repo, p),
          });
        } catch {
          // skip unreadable; reported via missing context is acceptable
        }
      }

      const messages: ChatMessage[] = [
        { role: "system", content: editSystemPrompt(contextFiles) },
        { role: "user", content: instruction },
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
        send({
          type: "error",
          code: err instanceof AIProviderError ? err.code : "provider",
          message:
            err instanceof AIProviderError
              ? err.message
              : "Edit request failed.",
        });
        close();
        return;
      }
      if (aborted.value) {
        send({ type: "error", code: "aborted", message: "Aborted" });
        close();
        return;
      }

      const blocks = parseFileBlocks(fullText);
      if (blocks.length === 0) {
        send({
          type: "error",
          code: "invalid_file",
          message:
            "The AI did not return any file changes. Nothing was modified.",
        });
        close();
        return;
      }

      // Rewrite ONLY returned files; validate every path.
      const changed: { path: string; bytes: number }[] = [];
      for (const block of blocks) {
        let safePath: string;
        try {
          safePath = validateFilePath(block.path);
        } catch (err) {
          send({
            type: "error",
            code: "invalid_path",
            message:
              err instanceof StorageError
                ? err.message
                : `Refusing unsafe path: ${block.path}`,
          });
          close();
          return;
        }
        send({ type: "file", path: safePath, status: "started" });
        try {
          const bytes = await writeProjectFile(repo, safePath, block.content);
          changed.push({ path: safePath, bytes });
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

      let commitSha: string | null = null;
      try {
        commitSha = await commitAll(
          repo,
          `Edit: ${instruction.slice(0, 120)}`,
        );
        await syncProjectFiles(project.id, repo);
        if (commitSha) {
          await prisma.projectVersion.create({
            data: {
              projectId: project.id,
              message: `Edit: ${instruction.slice(0, 120)}`,
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
              (usage?.promptTokens ?? estimateTokens(instruction)) +
              (usage?.completionTokens ?? estimateTokens(fullText)),
            model,
          },
        });
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

      send({ type: "done", commitSha, files: changed });
      close();
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
