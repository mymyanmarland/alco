import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userApiKey: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { encryptKey } from "./apikey-crypto";
import {
  apiKeyMissingResponse,
  getServerCredentials,
  getUserApiKey,
  resolveAiCredentials,
} from "./apikeys";

const ENC_KEY = "APP_ENCRYPTION_KEY";
const AI_KEY = "AI_API_KEY";
const AI_URL = "AI_BASE_URL";
const MASTER = "cc".repeat(32);

const findUnique = prisma.userApiKey.findUnique as ReturnType<typeof vi.fn>;

function snapshotEnv(): Record<string, string | undefined> {
  return {
    [ENC_KEY]: process.env[ENC_KEY],
    [AI_KEY]: process.env[AI_KEY],
    [AI_URL]: process.env[AI_URL],
  };
}
function restoreEnv(s: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("BYO key resolution", () => {
  const snap = snapshotEnv();
  afterEach(() => {
    restoreEnv(snap);
    vi.clearAllMocks();
  });

  it("user key wins over the server key", async () => {
    process.env[ENC_KEY] = MASTER;
    process.env[AI_KEY] = "sk-server-fallback";
    findUnique.mockResolvedValue({
      encryptedKey: encryptKey("sk-user-personal-key"),
      baseUrl: null,
    });
    const creds = await resolveAiCredentials("u1");
    expect(creds).not.toBeNull();
    expect(creds!.apiKey).toBe("sk-user-personal-key");
    expect(creds!.source).toBe("user");
  });

  it("user baseUrl override is honored", async () => {
    process.env[ENC_KEY] = MASTER;
    delete process.env[AI_KEY];
    findUnique.mockResolvedValue({
      encryptedKey: encryptKey("sk-user-personal-key"),
      baseUrl: "https://custom.example.com/v1/",
    });
    const creds = await resolveAiCredentials("u1");
    expect(creds!.baseUrl).toBe("https://custom.example.com/v1");
    expect(creds!.source).toBe("user");
  });

  it("falls back to the server key when the user has none", async () => {
    delete process.env[ENC_KEY];
    process.env[AI_KEY] = "sk-server-fallback";
    process.env[AI_URL] = "https://api.relaymodels.com/v1";
    findUnique.mockResolvedValue(null);
    const creds = await resolveAiCredentials("u1");
    expect(creds).toEqual({
      apiKey: "sk-server-fallback",
      baseUrl: "https://api.relaymodels.com/v1",
      source: "server",
    });
  });

  it("returns null when neither user key nor server key exists", async () => {
    delete process.env[ENC_KEY];
    delete process.env[AI_KEY];
    findUnique.mockResolvedValue(null);
    expect(await resolveAiCredentials("u1")).toBeNull();
    expect(getServerCredentials()).toBeNull();
  });

  it("a broken stored record behaves like no key (never throws)", async () => {
    process.env[ENC_KEY] = MASTER;
    delete process.env[AI_KEY];
    // Encrypted under a different master key → decrypt fails → null.
    const other = "dd".repeat(32);
    process.env[ENC_KEY] = other;
    const blob = encryptKey("sk-user-key");
    process.env[ENC_KEY] = MASTER;
    findUnique.mockResolvedValue({ encryptedKey: blob, baseUrl: null });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await getUserApiKey("u1")).toBeNull();
      expect(await resolveAiCredentials("u1")).toBeNull();
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it("apiKeyMissingResponse has the documented shape", async () => {
    const res = apiKeyMissingResponse();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("api_key_missing");
    expect(typeof body.message).toBe("string");
  });
});
