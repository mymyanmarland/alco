import { MockProvider } from "./mock-provider";
import { OpenAICompatibleProvider } from "./openai-provider";
import { MockBuilderProvider } from "../builder/mock-builder-provider";
import type { AIProvider } from "./types";

export * from "./types";

/** Selects the provider from env. Server-side only — never expose the key. */
export function getProvider(): AIProvider {
  const mode = (process.env.AI_PROVIDER || "").toLowerCase();
  if (mode === "mock-builder") {
    // Deterministic builder pipeline responses for M4 tests.
    return new MockBuilderProvider();
  }
  if (mode === "mock") {
    return new MockProvider();
  }
  return new OpenAICompatibleProvider();
}

/** Model ids the UI may offer, from AI_MODELS (comma-separated). */
export function getAvailableModels(): string[] {
  const raw = process.env.AI_MODELS || "";
  const models = raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (models.length > 0) return models;
  return [process.env.AI_DEFAULT_MODEL || "gpt-4o-mini"];
}

export function getDefaultModel(): string {
  return getAvailableModels()[0];
}

export function getTimeoutMs(): number {
  const raw = Number(process.env.AI_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 60_000;
}

/** Rough token estimate (~4 chars per token) when the provider reports none. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
