/** Provider-agnostic AI chat types. Server-side only — never import from client components. */

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Per-call credential override (BYO keys). Falls back to server env. */
export interface ProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
}

export interface StreamOptions {
  model: string;
  timeoutMs: number;
  maxTokens?: number;
  temperature?: number;
  /** Aborted when the client disconnects; providers should stop promptly. */
  signal?: AbortSignal;
  /** BYO key for this call; when absent the provider uses the server key. */
  credentials?: ProviderCredentials;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export type ProviderErrorCode =
  | "config"
  | "auth"
  | "rate_limit"
  | "provider"
  | "provider_http_error"
  | "timeout"
  | "network";

/** Honest, user-facing provider failure. `code` drives the message shown in the UI. */
export class AIProviderError extends Error {
  code: ProviderErrorCode;
  status?: number;

  constructor(code: ProviderErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
    this.status = status;
  }
}

export interface AIProvider {
  readonly name: string;
  /** Streams the assistant's reply as text chunks. Throws AIProviderError on failure. */
  streamChat(
    messages: ChatMessage[],
    opts: StreamOptions,
  ): AsyncIterable<string>;
  /** Token usage reported for the most recently completed stream, if any. */
  lastUsage: TokenUsage | null;
}
