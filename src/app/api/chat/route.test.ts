import { afterEach, describe, expect, it, vi } from "vitest";

const { mockRequireUserId, mockFindUnique, mockCheck } = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockFindUnique: vi.fn(),
  mockCheck: vi.fn(),
}));

vi.mock("@/lib/get-session", () => ({
  requireUserId: mockRequireUserId,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { userApiKey: { findUnique: mockFindUnique } },
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

const ENC_KEY = "APP_ENCRYPTION_KEY";
const AI_KEY = "AI_API_KEY";

describe("POST /api/chat without any API key", () => {
  const snap = { [ENC_KEY]: process.env[ENC_KEY], [AI_KEY]: process.env[AI_KEY] };
  afterEach(() => {
    for (const [k, v] of Object.entries(snap)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.clearAllMocks();
  });

  it("returns 400 api_key_missing when neither user nor server key exists", async () => {
    delete process.env[ENC_KEY];
    delete process.env[AI_KEY];
    mockRequireUserId.mockResolvedValue("u1");
    mockCheck.mockReturnValue({ ok: true });
    mockFindUnique.mockResolvedValue(null);

    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("api_key_missing");
    expect(typeof body.message).toBe("string");
  });

  it("still 401s anonymous callers before key resolution", async () => {
    mockRequireUserId.mockResolvedValue(null);
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
