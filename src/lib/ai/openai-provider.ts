import {
  AIProvider,
  AIProviderError,
  type ChatMessage,
  type StreamOptions,
  type TokenUsage,
} from "./types";

/**
 * OpenAI-compatible chat-completions provider (works with OpenAI, RelayModels,
 * and any /v1-compatible gateway). Server-side only: the API key never leaves
 * the server. Streams genuine provider bytes — no simulated output.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name = "openai-compatible";
  lastUsage: TokenUsage | null = null;

  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = (
      process.env.AI_BASE_URL || "https://api.openai.com/v1"
    ).replace(/\/$/, "");
    this.apiKey = process.env.AI_API_KEY || "";
  }

  async *streamChat(
    messages: ChatMessage[],
    opts: StreamOptions,
  ): AsyncIterable<string> {
    this.lastUsage = null;
    // BYO: per-call override wins; otherwise the server-wide key (fallback).
    const apiKey = opts.credentials?.apiKey || this.apiKey;
    const baseUrl = (opts.credentials?.baseUrl || this.baseUrl).replace(
      /\/$/,
      "",
    );
    if (!apiKey) {
      throw new AIProviderError(
        "config",
        "No API key is configured. Add your API key in Settings.",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
    // Propagate client disconnects so upstream stops promptly too.
    const onClientAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onClientAbort);

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
          // Ask for usage on the final chunk when the gateway supports it.
          stream_options: { include_usage: true },
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
          ...(opts.temperature !== undefined
            ? { temperature: opts.temperature }
            : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        throw new AIProviderError(
          "timeout",
          `The AI request timed out after ${Math.round(opts.timeoutMs / 1000)}s.`,
        );
      }
      throw new AIProviderError(
        "network",
        "Could not reach the AI provider. Check the network and AI_BASE_URL.",
      );
    }

    if (!res.ok || !res.body) {
      clearTimeout(timeout);
      const detail = await safeBodyText(res);
      throw mapHttpError(res.status, detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            clearTimeout(timeout);
            return;
          }
          let payload: {
            choices?: { delta?: { content?: string } }[];
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
            };
          };
          try {
            payload = JSON.parse(data);
          } catch {
            continue; // ignore malformed SSE lines
          }
          const text = payload.choices?.[0]?.delta?.content;
          if (typeof text === "string" && text.length > 0) {
            yield text;
          }
          if (payload.usage) {
            this.lastUsage = {
              promptTokens: payload.usage.prompt_tokens,
              completionTokens: payload.usage.completion_tokens,
            };
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener("abort", onClientAbort);
      reader.releaseLock();
    }
  }
}

/**
 * Maps an upstream HTTP failure to a clean, user-facing AIProviderError.
 *
 * Rules:
 * - 401/403 → auth: the key is wrong (message points at Settings).
 * - 429 → rate_limit.
 * - JSON error body → preserve the provider's own message (truncated).
 * - Anything else (e.g. an HTML 404 page from a wrong Base URL) →
 *   provider_http_error with a clean message. Raw HTML is NEVER included:
 *   it is stripped and the whole body is dropped when it looks like markup.
 */
export function mapHttpError(status: number, detail: string): AIProviderError {
  if (status === 401 || status === 403) {
    return new AIProviderError(
      "auth",
      "The AI provider rejected the API key. Check the key in Settings.",
      status,
    );
  }
  if (status === 429) {
    return new AIProviderError(
      "rate_limit",
      "The AI provider is rate-limited right now. Please try again shortly.",
      status,
    );
  }
  const jsonMessage = extractJsonErrorMessage(detail);
  if (jsonMessage) {
    return new AIProviderError(
      "provider",
      `The AI provider returned an error (${status}): ${jsonMessage}`,
      status,
    );
  }
  return new AIProviderError(
    "provider_http_error",
    `The AI provider returned HTTP ${status}. Check the Base URL in Settings (e.g. https://api.relaymodels.com/v1).`,
    status,
  );
}

/** Pulls a human message out of a JSON error body, or null when absent. */
function extractJsonErrorMessage(detail: string): string | null {
  if (!detail || looksLikeHtml(detail)) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    const err =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { error?: unknown; message?: unknown }).error ??
          (parsed as { message?: unknown }).message
        : null;
    const msg =
      typeof err === "string"
        ? err
        : typeof err === "object" && err !== null
          ? (err as { message?: unknown }).message
          : null;
    if (typeof msg === "string" && msg.trim().length > 0) {
      // Strip any stray tags, collapse whitespace, cap length.
      return msg
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
    }
  } catch {
    // not JSON — handled as provider_http_error by the caller
  }
  return null;
}

/** True when the body is (or starts like) an HTML document. */
function looksLikeHtml(s: string): boolean {
  return /<\s*(!doctype|html|head|body)\b/i.test(s.slice(0, 500));
}

async function safeBodyText(res: Response): Promise<string> {
  try {
    // Cap the read: error pages can be large and we only need a sniff.
    const text = await res.text();
    return text.length > 8192 ? text.slice(0, 8192) : text;
  } catch {
    return "";
  }
}
