import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __clearProviderModelsCache,
  fetchProviderModels,
  getCachedProviderModels,
  invalidModelResponse,
  isSafeModelId,
  ProviderModelsError,
  resolveRequestModel,
} from "./provider-models";
import type { ResolvedAiCredentials } from "./apikeys";

const userCreds = (over: Partial<ResolvedAiCredentials> = {}): ResolvedAiCredentials => ({
  apiKey: "sk-user",
  baseUrl: "https://api.example.com/v1",
  source: "user",
  ...over,
});

function mockFetchOnce(impl: () => Promise<unknown>) {
  const fn = vi.fn().mockImplementation(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const okModels = (ids: string[]) =>
  mockFetchOnce(async () => ({
    ok: true,
    json: async () => ({ data: ids.map((id) => ({ id })) }),
  }));

describe("isSafeModelId", () => {
  it.each(["claude-opus-5", "gemini-3.8-flash", "openai/gpt-4o-mini", "a"])(
    "accepts %s",
    (id) => expect(isSafeModelId(id)).toBe(true),
  );
  it.each(["", "../../x", "a".repeat(101), "model; rm -rf", "line\nbreak", ".."])(
    "rejects %s",
    (id) => expect(isSafeModelId(id)).toBe(false),
  );
});

describe("fetchProviderModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __clearProviderModelsCache();
  });

  it("dedupes, sorts, and returns ids from the {data} shape", async () => {
    okModels(["b-model", "a-model", "b-model"]);
    await expect(fetchProviderModels(userCreds())).resolves.toEqual([
      "a-model",
      "b-model",
    ]);
  });

  it("supports the {models} shape", async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({ models: ["z", "a"] }),
    }));
    await expect(fetchProviderModels(userCreds())).resolves.toEqual(["a", "z"]);
  });

  it("caps at 200 models", async () => {
    okModels(Array.from({ length: 250 }, (_, i) => `m-${i}`));
    const models = await fetchProviderModels(userCreds());
    expect(models).toHaveLength(200);
  });

  it("throws ProviderModelsError on upstream non-2xx", async () => {
    mockFetchOnce(async () => ({ ok: false, status: 401 }));
    await expect(fetchProviderModels(userCreds())).rejects.toBeInstanceOf(
      ProviderModelsError,
    );
  });

  it("throws ProviderModelsError on unreadable JSON", async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    }));
    await expect(fetchProviderModels(userCreds())).rejects.toBeInstanceOf(
      ProviderModelsError,
    );
  });

  it("throws ProviderModelsError on network failure", async () => {
    mockFetchOnce(async () => {
      throw new Error("down");
    });
    await expect(fetchProviderModels(userCreds())).rejects.toBeInstanceOf(
      ProviderModelsError,
    );
  });

  it("sends the key only in the Authorization header", async () => {
    const fn = okModels(["m"]);
    await fetchProviderModels(userCreds());
    expect(fn).toHaveBeenCalledWith(
      "https://api.example.com/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-user" },
      }),
    );
  });
});

describe("getCachedProviderModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __clearProviderModelsCache();
  });

  it("caches per user+key and does not refetch within TTL", async () => {
    const fn = okModels(["m"]);
    const creds = userCreds();
    await getCachedProviderModels("u1", creds);
    await getCachedProviderModels("u1", creds);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("resolveRequestModel", () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD_ENV };
    vi.unstubAllGlobals();
    __clearProviderModelsCache();
  });

  it("user source: accepts a safe requested model without fetching", async () => {
    const fn = mockFetchOnce(async () => {
      throw new Error("must not fetch");
    });
    const r = await resolveRequestModel("u1", userCreds(), "claude-opus-5");
    expect(r).toEqual({ ok: true, model: "claude-opus-5" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("user source: missing model falls back to first fetched model", async () => {
    okModels(["zzz", "aaa"]);
    const r = await resolveRequestModel("u1", userCreds(), undefined);
    expect(r).toEqual({ ok: true, model: "aaa" });
  });

  it("user source: unsafe model + failed fetch → invalid_model", async () => {
    mockFetchOnce(async () => {
      throw new Error("down");
    });
    const r = await resolveRequestModel("u1", userCreds(), "../../x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(400);
      const body = await r.response.json();
      expect(body.error).toBe("invalid_model");
    }
  });

  it("user source: missing model + failed fetch → invalid_model", async () => {
    mockFetchOnce(async () => ({ ok: false, status: 500 }));
    const r = await resolveRequestModel("u1", userCreds(), null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });

  it("server source: keeps the legacy allowlist behavior", async () => {
    process.env.AI_MODELS = "m1,m2";
    process.env.AI_DEFAULT_MODEL = "m1";
    const creds = userCreds({ source: "server" });
    expect(await resolveRequestModel("u1", creds, "m2")).toEqual({
      ok: true,
      model: "m2",
    });
    // unknown → default (legacy fallback, NOT invalid_model)
    expect(await resolveRequestModel("u1", creds, "nope")).toEqual({
      ok: true,
      model: "m1",
    });
    expect(await resolveRequestModel("u1", creds, undefined)).toEqual({
      ok: true,
      model: "m1",
    });
  });

  it("invalidModelResponse has the expected shape", async () => {
    const res = invalidModelResponse();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_model");
    expect(typeof body.message).toBe("string");
  });
});
