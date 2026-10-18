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
import { parsePlan, planSystemPrompt } from "@/lib/builder/prompts";
import { sseEncode, sseHeaders, type BuilderEvent } from "@/lib/builder/sse";

const MAX_PROMPT_LEN = 4000;

/** POST /api/builder/plan — { projectId, prompt } → streams a validated build plan. */
export async function POST(request: Request) {
  let body: { projectId?: unknown; prompt?: unknown; model?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const guard = await requireOwnedProject(body.projectId);
  if ("response" in guard) return guard.response;
  const { userId } = guard;

  // M6-A: rate limit + daily AI token quota BEFORE the provider call.
  const rl = defaultLimiter.check(
    `builder:plan:${rateLimitKey(request, userId)}`,
    rateLimitPerMinute(),
    60_000,
  );
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);
  const quota = await checkAiTokenQuota(userId);
  if (!quota.ok) return quotaExceededResponse(quota);

  // BYO keys: user key → server AI_API_KEY fallback → 400 api_key_missing.
  const creds = await resolveAiCredentials(userId);
  if (!creds) return apiKeyMissingResponse();

  const prompt =
    typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > MAX_PROMPT_LEN) {
    return NextResponse.json(
      { error: "Prompt is required (max 4000 chars)" },
      { status: 400 },
    );
  }

  const modelResolution = await resolveRequestModel(userId, creds, body.model);
  if (!modelResolution.ok) return modelResolution.response;
  const model = modelResolution.model;

  const provider = getProvider();
  const timeoutMs = getTimeoutMs();
  const messages: ChatMessage[] = [
    { role: "system", content: planSystemPrompt() },
    { role: "user", content: prompt },
  ];
  const aborted = { value: false };
  request.signal.addEventListener("abort", () => {
    aborted.value = true;
  });

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = "";
      let streamError: AIProviderError | null = null;
      let clientGone = false;

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
        if (aborted.value) {
          clientGone = true;
        } else {
          streamError =
            err instanceof AIProviderError
              ? err
              : new AIProviderError("provider", "Plan generation failed.");
        }
      }

      const finish = (e: BuilderEvent) => {
        if (!clientGone) {
          try {
            controller.enqueue(sseEncode(e));
          } catch {
            // client disconnected
          }
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      if (clientGone) {
        finish({ type: "error", code: "aborted", message: "Aborted" });
        return;
      }
      if (streamError) {
        finish({
          type: "error",
          code: streamError.code,
          message: streamError.message,
        });
        return;
      }

      const plan = parsePlan(fullText);
      if (!plan) {
        finish({
          type: "error",
          code: "invalid_plan",
          message:
            "The AI did not return a valid build plan. Please try again or rephrase your prompt.",
        });
        return;
      }

      // Metering (best-effort; never blocks the response).
      try {
        const usage = provider.lastUsage;
        await prisma.usageEvent.create({
          data: {
            userId,
            kind: "ai_tokens",
            quantity:
              (usage?.promptTokens ?? estimateTokens(prompt)) +
              (usage?.completionTokens ?? estimateTokens(fullText)),
            model,
          },
        });
      } catch {
        // metering failure must not fail the plan
      }

      finish({ type: "plan", plan });
      // Keep the stream open-pattern consistent: send done after plan.
      if (!clientGone) {
        try {
          controller.enqueue(sseEncode({ type: "done" }));
        } catch {
          // ignore
        }
      }
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
