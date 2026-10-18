import { afterEach, describe, expect, it, vi } from "vitest";

const { mockRequireUserId, mockCheck, mockResolve } = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockCheck: vi.fn(),
  mockResolve: vi.fn(),
}));

vi.mock("@/lib/get-session", () => ({
  requireUserId: mockRequireUserId,
}));
vi.mock("@/lib/rate-limit", () => ({
  defaultLimiter: { check: mockCheck },
  rateLimitKey: (_req: Request, userId: string) => userId,
  rateLimitPerMinute: () => 60,
  rateLimitedResponse: () =>
    new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }),
}));
vi.mock("@/lib/apikeys", () => ({
  resolveAiCredentials: mockResolve,
  apiKeyMissingResponse: () =>
    Response.json(
      { error: "api_key_missing", message: "Add your API key in Settings." },
      { status: 400 },
    ),
}));

import { GET } from "./route";

const SECRET = "super-secret-user-key-0123456789abcdef";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authed() {
  mockRequireUserId.mockResolvedValue("u1");
  mockCheck.mockReturnValue({ ok: true });
  mockResolve.mockResolvedValue({
    apiKey: SECRET,
    baseUrl: "https://provider.test/v1",
    source: "user",
  });
}

describe("GET /api/ai/models", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.clearAllMocks();
  });

  it("anon → 401", async () => {
    mockRequireUserId.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/ai/models"));
    expect(res.status).toBe(401);
  });

  it("rate-limited → 429", async () => {
    mockRequireUserId.mockResolvedValue("u1");
    mockCheck.mockReturnValue({ ok: false, retryAfterMs: 1000 });
    const res = await GET(new Request("http://localhost/api/ai/models"));
    expect(res.status).toBe(429);
  });

  it("no credentials → api_key_missing", async () => {
    mockRequireUserId.mockResolvedValue("u1");
    mockCheck.mockReturnValue({ ok: true });
    mockResolve.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/ai/models"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("api_key_missing");
  });

  it("upstream {data:[{id}]} → sorted, deduped ids; key in header, never in body", async () => {
    authed();
    let seenUrl = "";
    let seenAuth = "";
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      seenUrl = String(url);
      const h = init?.headers as Record<string, string> | undefined;
      seenAuth = h?.["Authorization"] ?? "";
      return jsonResponse({
        data: [{ id: "zeta" }, { id: "alpha" }, { id: "zeta" }, { id: 42 }],
      });
    }) as typeof fetch;

    const res = await GET(new Request("http://localhost/api/ai/models"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ models: ["alpha", "zeta"] });
    expect(seenUrl).toBe("https://provider.test/v1/models");
    expect(seenAuth).toBe(`Bearer ${SECRET}`);
  });

  it("upstream {models:[...]} shape also works", async () => {
    authed();
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ models: ["b", "a"] }),
    ) as typeof fetch;
    const res = await GET(new Request("http://localhost/api/ai/models"));
    expect((await res.json()).models).toEqual(["a", "b"]);
  });

  it("upstream 500 → 502 models_fetch_failed without the key", async () => {
    authed();
    globalThis.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as typeof fetch;
    const res = await GET(new Request("http://localhost/api/ai/models"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("models_fetch_failed");
    expect(typeof body.message).toBe("string");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("network throw → 502 models_fetch_failed", async () => {
    authed();
    globalThis.fetch = vi.fn(async () => {
      throw new Error("socket down");
    }) as typeof fetch;
    const res = await GET(new Request("http://localhost/api/ai/models"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("models_fetch_failed");
  });

  it("non-JSON upstream body → 502 models_fetch_failed", async () => {
    authed();
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<html>nope</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    ) as typeof fetch;
    const res = await GET(new Request("http://localhost/api/ai/models"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("models_fetch_failed");
  });

  it("caps the list at 200 models", async () => {
    authed();
    const many = Array.from({ length: 250 }, (_, i) => ({
      id: `m-${String(i).padStart(3, "0")}`,
    }));
    globalThis.fetch = vi.fn(async () => jsonResponse({ data: many })) as typeof fetch;
    const res = await GET(new Request("http://localhost/api/ai/models"));
    expect((await res.json()).models).toHaveLength(200);
  });
});
