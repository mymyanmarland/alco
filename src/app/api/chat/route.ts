import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/get-session";
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
  AIProviderError,
  estimateTokens,
  getAvailableModels,
  getDefaultModel,
  getProvider,
  getTimeoutMs,
  type ChatMessage,
} from "@/lib/ai";

const HISTORY_LIMIT = 30;
const MAX_MESSAGE_LEN = 8000;

type SSEEvent =
  | { type: "chunk"; text: string }
  | {
      type: "done";
      conversationId: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
    }
  | { type: "error"; code: string; message: string };

function sse(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Models the client may offer in the model selector. Key stays server-side. */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    models: getAvailableModels(),
    defaultModel: getDefaultModel(),
  });
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // M6-A: rate limit + daily AI token quota BEFORE any expensive work.
  const rl = defaultLimiter.check(
    `chat:${rateLimitKey(request, userId)}`,
    rateLimitPerMinute(),
    60_000,
  );
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);
  const quota = await checkAiTokenQuota(userId);
  if (!quota.ok) return quotaExceededResponse(quota);

  // BYO keys: user key → server AI_API_KEY fallback → 400 api_key_missing.
  const creds = await resolveAiCredentials(userId);
  if (!creds) return apiKeyMissingResponse();

  let body: {
    conversationId?: unknown;
    message?: unknown;
    model?: unknown;
    retry?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const retry = body.retry === true;
  const modelResolution = await resolveRequestModel(userId, creds, body.model);
  if (!modelResolution.ok) return modelResolution.response;
  const model = modelResolution.model;

  // Ownership-scoped conversation lookup.
  let conversationId =
    typeof body.conversationId === "string" ? body.conversationId : null;
  let conversation = conversationId
    ? await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
      })
    : null;
  if (conversationId && !conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 },
    );
  }

  let userText: string;
  if (retry) {
    if (!conversation) {
      return NextResponse.json(
        { error: "conversationId is required for retry" },
        { status: 400 },
      );
    }
    const lastUser = await prisma.message.findFirst({
      where: { conversationId: conversation.id, role: "user" },
      orderBy: { createdAt: "desc" },
    });
    if (!lastUser) {
      return NextResponse.json({ error: "Nothing to retry" }, { status: 400 });
    }
    userText = lastUser.content;
  } else {
    const rawMessage =
      typeof body.message === "string" ? body.message.trim() : "";
    if (!rawMessage || rawMessage.length > MAX_MESSAGE_LEN) {
      return NextResponse.json(
        { error: "Message is required (max 8000 chars)" },
        { status: 400 },
      );
    }
    userText = rawMessage;
    if (!conversation) {
      const title =
        userText.length > 60 ? userText.slice(0, 60).trimEnd() + "…" : userText;
      conversation = await prisma.conversation.create({
        data: { userId, title },
      });
      conversationId = conversation.id;
    }
    await prisma.message.create({
      data: { conversationId: conversation.id, role: "user", content: userText },
    });
  }

  // Recent history as context (oldest first).
  const history = await prisma.message.findMany({
    where: { conversationId: conversation!.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { role: true, content: true },
  });
  const chatMessages: ChatMessage[] = history.reverse().map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  const provider = getProvider();
  const timeoutMs = getTimeoutMs();
  const encoder = new TextEncoder();
  const aborted = { value: false };
  request.signal.addEventListener("abort", () => {
    aborted.value = true;
  });

  const finalConversationId = conversation!.id;

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = "";
      let streamError: AIProviderError | null = null;
      let clientGone = false;

      try {
        for await (const chunk of provider.streamChat(chatMessages, {
          model,
          timeoutMs,
          signal: request.signal,
          credentials: { apiKey: creds.apiKey, baseUrl: creds.baseUrl },
        })) {
          if (aborted.value) break;
          fullText += chunk;
          controller.enqueue(encoder.encode(sse({ type: "chunk", text: chunk })));
        }
      } catch (err) {
        if (aborted.value) {
          clientGone = true;
        } else {
          streamError =
            err instanceof AIProviderError
              ? err
              : new AIProviderError(
                  "provider",
                  "The AI request failed unexpectedly.",
                );
        }
      }

      const trimmed = fullText.trim();
      const usage = provider.lastUsage;
      const promptTokens =
        usage?.promptTokens ??
        estimateTokens(chatMessages.map((m) => m.content).join("\n"));
      const completionTokens =
        usage?.completionTokens ?? estimateTokens(fullText);

      // Persist everything before closing: no work happens after the response.
      try {
        if (trimmed) {
          await prisma.message.create({
            data: {
              conversationId: finalConversationId,
              role: "assistant",
              content: fullText,
              tokensUsed: completionTokens,
            },
          });
        }
        if (!streamError && !clientGone && trimmed) {
          await prisma.usageEvent.create({
            data: {
              userId,
              kind: "ai_tokens",
              quantity: promptTokens + completionTokens,
              model,
            },
          });
        }
        await prisma.conversation.update({
          where: { id: finalConversationId },
          data: { updatedAt: new Date() },
        });
      } catch {
        if (!clientGone) {
          try {
            controller.enqueue(
              encoder.encode(
                sse({
                  type: "error",
                  code: "provider",
                  message:
                    "The reply was generated but could not be saved. Please try again.",
                }),
              ),
            );
          } catch {
            // client already gone
          }
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
        return;
      }

      if (!clientGone) {
        try {
          if (streamError) {
            controller.enqueue(
              encoder.encode(
                sse({
                  type: "error",
                  code: streamError.code,
                  message: streamError.message,
                }),
              ),
            );
          } else {
            controller.enqueue(
              encoder.encode(
                sse({
                  type: "done",
                  conversationId: finalConversationId,
                  model,
                  promptTokens,
                  completionTokens,
                }),
              ),
            );
          }
        } catch {
          // client disconnected mid-flush
        }
      }
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
