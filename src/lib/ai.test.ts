import { afterEach, describe, expect, it } from "vitest";
import {
  estimateTokens,
  getAvailableModels,
  getDefaultModel,
  getTimeoutMs,
} from "./ai";
import { mapHttpError } from "./ai/openai-provider";

const ENV_KEYS = [
  "AI_MODELS",
  "AI_DEFAULT_MODEL",
  "AI_TIMEOUT_MS",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

describe("estimateTokens", () => {
  it("estimates ~4 chars per token with a minimum of 1", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("model selection from env", () => {
  const snap = snapshotEnv();
  afterEach(() => restoreEnv(snap));

  it("parses AI_MODELS comma-separated and trims", () => {
    process.env.AI_MODELS = " gemini-3.8-flash , gpt-4o-mini ,,";
    expect(getAvailableModels()).toEqual(["gemini-3.8-flash", "gpt-4o-mini"]);
    expect(getDefaultModel()).toBe("gemini-3.8-flash");
  });

  it("falls back to AI_DEFAULT_MODEL when AI_MODELS is empty", () => {
    delete process.env.AI_MODELS;
    process.env.AI_DEFAULT_MODEL = "my-model";
    expect(getAvailableModels()).toEqual(["my-model"]);
    expect(getDefaultModel()).toBe("my-model");
  });

  it("falls back to gpt-4o-mini when nothing is set", () => {
    delete process.env.AI_MODELS;
    delete process.env.AI_DEFAULT_MODEL;
    expect(getAvailableModels()).toEqual(["gpt-4o-mini"]);
  });
});

describe("getTimeoutMs", () => {
  const snap = snapshotEnv();
  afterEach(() => restoreEnv(snap));

  it("parses a valid timeout", () => {
    process.env.AI_TIMEOUT_MS = "30000";
    expect(getTimeoutMs()).toBe(30000);
  });

  it("falls back to 60000 for invalid values", () => {
    process.env.AI_TIMEOUT_MS = "nope";
    expect(getTimeoutMs()).toBe(60000);
    process.env.AI_TIMEOUT_MS = "-5";
    expect(getTimeoutMs()).toBe(60000);
    delete process.env.AI_TIMEOUT_MS;
    expect(getTimeoutMs()).toBe(60000);
  });
});

describe("mapHttpError sanitization", () => {
  const HTML_404 =
    '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><title>404</title></head><body><h1>Not Found</h1></body></html>';

  it("HTML body → provider_http_error with no markup in the message", () => {
    const err = mapHttpError(404, HTML_404);
    expect(err.code).toBe("provider_http_error");
    expect(err.status).toBe(404);
    expect(err.message).not.toContain("<");
    expect(err.message).not.toContain("DOCTYPE");
    expect(err.message).toContain("404");
    expect(err.message).toContain("Base URL");
  });

  it("plain-text body → provider_http_error, never echoes the body", () => {
    const err = mapHttpError(400, "Bad Request: something weird happened");
    expect(err.code).toBe("provider_http_error");
    expect(err.message).not.toContain("something weird");
  });

  it("JSON error body → provider code with the provider message preserved", () => {
    const err = mapHttpError(
      400,
      JSON.stringify({ error: { message: "model_not_found", type: "x" } }),
    );
    expect(err.code).toBe("provider");
    expect(err.message).toContain("model_not_found");
  });

  it("JSON 5xx body → provider code with preserved message", () => {
    const err = mapHttpError(
      500,
      JSON.stringify({ error: "internal failure at gateway" }),
    );
    expect(err.code).toBe("provider");
    expect(err.message).toContain("internal failure at gateway");
  });

  it("401 keeps the check-the-key message", () => {
    const err = mapHttpError(401, JSON.stringify({ error: "bad key" }));
    expect(err.code).toBe("auth");
    expect(err.message).toContain("Settings");
  });

  it("429 keeps the rate-limit message", () => {
    const err = mapHttpError(429, "");
    expect(err.code).toBe("rate_limit");
  });

  it("strips tags from a JSON message payload", () => {
    const err = mapHttpError(
      400,
      JSON.stringify({ error: { message: "<b>oops</b> bad" } }),
    );
    expect(err.message).not.toContain("<b>");
    expect(err.message).toContain("oops bad");
  });
});
