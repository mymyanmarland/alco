import { afterEach, describe, expect, it, vi } from "vitest";

const { mockRequireUserId, mockUserApiKey } = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockUserApiKey: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock("@/lib/get-session", () => ({
  requireUserId: mockRequireUserId,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { userApiKey: mockUserApiKey },
}));

import { DELETE, GET, POST } from "./route";
import { decryptKey } from "@/lib/apikey-crypto";

const ENC_KEY = "APP_ENCRYPTION_KEY";
const MASTER = "ee".repeat(32);

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/settings/api-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/settings/api-key", () => {
  const snapEnc = process.env[ENC_KEY];
  afterEach(() => {
    if (snapEnc === undefined) delete process.env[ENC_KEY];
    else process.env[ENC_KEY] = snapEnc;
    vi.clearAllMocks();
  });

  it("anon GET → 401", async () => {
    mockRequireUserId.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("anon POST → 401, anon DELETE → 401", async () => {
    mockRequireUserId.mockResolvedValue(null);
    expect((await POST(postReq({ key: "x".repeat(30) }))).status).toBe(401);
    expect((await DELETE()).status).toBe(401);
  });

  it("GET with no stored key → {configured:false}", async () => {
    mockRequireUserId.mockResolvedValue("u1");
    mockUserApiKey.findUnique.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });
  });

  it("GET returns the public shape only — never key material", async () => {
    mockRequireUserId.mockResolvedValue("u1");
    mockUserApiKey.findUnique.mockResolvedValue({
      provider: "relaymodels",
      keyHint: "7890",
      baseUrl: null,
      createdAt: new Date("2026-10-18T10:00:00Z"),
    });
    const body = await (await GET()).json();
    expect(body.configured).toBe(true);
    expect(body.keyHint).toBe("7890");
    expect(JSON.stringify(body)).not.toContain("encryptedKey");
    expect(body.encryptedKey).toBeUndefined();
  });

  it("user B never sees user A's key (ownership-scoped lookup)", async () => {
    mockRequireUserId.mockResolvedValue("userB");
    mockUserApiKey.findUnique.mockResolvedValue(null);
    const body = await (await GET()).json();
    expect(body).toEqual({ configured: false });
    // The query is scoped to the session user — A's row is unreachable.
    expect(mockUserApiKey.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_provider: { userId: "userB", provider: "relaymodels" },
        },
      }),
    );
  });

  it("POST rejects short keys", async () => {
    mockRequireUserId.mockResolvedValue("u1");
    const res = await POST(postReq({ key: "too-short" }));
    expect(res.status).toBe(400);
    expect(mockUserApiKey.upsert).not.toHaveBeenCalled();
  });

  it("POST rejects invalid baseUrl", async () => {
    mockRequireUserId.mockResolvedValue("u1");
    const res = await POST(
      postReq({ key: "x".repeat(30), baseUrl: "not a url" }),
    );
    expect(res.status).toBe(400);
  });

  it("POST stores the key encrypted and never echoes it", async () => {
    process.env[ENC_KEY] = MASTER;
    mockRequireUserId.mockResolvedValue("u1");
    mockUserApiKey.upsert.mockImplementation(async (args: never) => {
      const a = args as {
        create: {
          encryptedKey: string;
          keyHint: string;
          baseUrl: string | null;
        };
      };
      // Ciphertext roundtrips but is not the plaintext.
      expect(a.create.encryptedKey).not.toContain("sk-user-secret-abcdef");
      expect(decryptKey(a.create.encryptedKey)).toBe("sk-user-secret-abcdef");
      expect(a.create.keyHint).toBe("cdef");
      return {
        provider: "relaymodels",
        keyHint: "cdef",
        baseUrl: "https://api.relaymodels.com/v1",
        createdAt: new Date("2026-10-18T10:00:00Z"),
      };
    });
    const res = await POST(
      postReq({
        key: "sk-user-secret-abcdef",
        baseUrl: "https://api.relaymodels.com/v1",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.keyHint).toBe("cdef");
    expect(JSON.stringify(body)).not.toContain("sk-user-secret-abcdef");
  });

  it("POST without APP_ENCRYPTION_KEY → 500 server_misconfigured", async () => {
    delete process.env[ENC_KEY];
    mockRequireUserId.mockResolvedValue("u1");
    const res = await POST(postReq({ key: "x".repeat(30) }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("server_misconfigured");
    expect(mockUserApiKey.upsert).not.toHaveBeenCalled();
  });

  it("DELETE with no key → 404; with key → ok", async () => {
    mockRequireUserId.mockResolvedValue("u1");
    mockUserApiKey.deleteMany.mockResolvedValue({ count: 0 });
    expect((await DELETE()).status).toBe(404);
    mockUserApiKey.deleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // Scoped to the session user — user B can only delete their own row.
    expect(mockUserApiKey.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", provider: "relaymodels" },
      }),
    );
  });
});
