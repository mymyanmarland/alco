import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireUserId,
  mockFindUnique,
  mockCheck,
  mockConvFindFirst,
  mockConvCreate,
  mockConvUpdate,
  mockMsgFindFirst,
  mockMsgFindMany,
  mockMsgCreate,
  mockUsageCreate,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockFindUnique: vi.fn(),
  mockCheck: vi.fn(),
  mockConvFindFirst: vi.fn(),
  mockConvCreate: vi.fn(),
  mockConvUpdate: vi.fn(),
  mockMsgFindFirst: vi.fn(),
  mockMsgFindMany: vi.fn(),
  mockMsgCreate: vi.fn(),
  mockUsageCreate: vi.fn(),
}));

vi.mock("@/lib/get-session", () => ({
  requireUserId: mockRequireUserId,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    userApiKey: { findUnique: mockFindUnique },
    conversation: {
      findFirst: mockConvFindFirst,
      create: mockConvCreate,
      update: mockConvUpdate,
    },
    message: {
      findFirst: mockMsgFindFirst,
      findMany: mockMsgFindMany,
      create: mockMsgCreate,
    },
    usageEvent: { create: mockUsageCreate },
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  defaultLimiter: { check: mockCheck },
  rateLimitKey: (_req: Request, userId: string) => userId,
  rateLimitPerMinute: () => 60,
  rateLimitedResponse: () => new Response("limited", { status: 429 }),
}));
vi.mock("@/lib/quotas", () => ({
  checkAiTokenQuota: vi.fn().mockResolvedValue({ ok: true }),
  quotaExceededResponse: () => new Response("quota", { status: 429 }),
}));

import { POST } from "./route";
import { encryptKey } from "@/lib/apikey-crypto";
import { __clearProviderModelsCache } from "@/lib/provider-models";

const ENC_KEY = "APP_ENCRYPTION_KEY";
const AI_KEY = "AI_API_KEY";
const AI_PROVIDER = "AI_PROVIDER";

function sseEvents(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n\n")
    .map((b) => b.trim())
    .filter((b) => b.startsWith("data: "))
    .map((b) => JSON.parse(b.slice(6)));
}

describe("POST /api/chat model resolution with a user (BYO) key", () => {
  const snap = {
    [ENC_KEY]: process.env[ENC_KEY],
    [AI_KEY]: process.env[AI_KEY],
    [AI_PROVIDER]: process.env[AI_PROVIDER],
  };

  beforeEach(() => {
    process.env[ENC_KEY] =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env[AI_PROVIDER] = "mock";
    delete process.env[AI_KEY];
    mockRequireUserId.mockResolvedValue("u1");
    mockCheck.mockReturnValue({ ok: true });
    mockConvFindFirst.mockResolvedValue(null);
    mockConvCreate.mockResolvedValue({ id: "c1" });
    mockConvUpdate.mockResolvedValue({});
    mockMsgFindFirst.mockResolvedValue(null);
    mockMsgFindMany.mockResolvedValue([]);
    mockMsgCreate.mockResolvedValue({});
    mockUsageCreate.mockResolvedValue({});
    // Stored user key (BYO) — resolution source is "user".
    mockFindUnique.mockResolvedValue({
      encryptedKey: encryptKey("sk-user-key"),
      baseUrl: "https://api.example.com/v1",
    });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(snap)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    __clearProviderModelsCache();
  });

  it("uses the requested provider model as-is (no server allowlist)", async () => {
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", model: "claude-opus-5" }),
      }),
    );
    expect(res.status).toBe(200);
    const events = sseEvents(await res.text());
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done!.model).toBe("claude-opus-5");
  });

  it("unsafe model id + unreachable provider → 400 invalid_model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("unreachable")),
    );
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", model: "../../x" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_model");
  });

  it("missing model falls back to the first live provider model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: "zzz" }, { id: "aaa" }] }),
      }),
    );
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }),
    );
    expect(res.status).toBe(200);
    const events = sseEvents(await res.text());
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done!.model).toBe("aaa");
  });
});
