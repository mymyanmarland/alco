import { describe, expect, it } from "vitest";
import { checkPreview, registerPreview, resolvePreviewPath } from "./preview";

describe("preview token validation", () => {
  it("accepts the exact issued token", () => {
    const { token } = registerPreview("run-ok", "/tmp/dir");
    expect(checkPreview("run-ok", token)).toEqual({
      ok: true,
      dir: "/tmp/dir",
    });
  });

  it("rejects a wrong token (timing-safe compare)", () => {
    const { token } = registerPreview("run-wrong", "/tmp/dir");
    const bad = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(checkPreview("run-wrong", bad)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("rejects a token of the wrong length", () => {
    registerPreview("run-short", "/tmp/dir");
    expect(checkPreview("run-short", "abc")).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("rejects non-hex tokens", () => {
    registerPreview("run-nonhex", "/tmp/dir");
    expect(checkPreview("run-nonhex", "zzzz")).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("returns not_found for unknown run ids", () => {
    expect(checkPreview("no-such-run", "abcd")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("resolvePreviewPath", () => {
  const dir = "/tmp/preview-root";

  it("resolves files inside the dir", () => {
    expect(resolvePreviewPath(dir, ["index.html"])).toBe(
      "/tmp/preview-root/index.html",
    );
    expect(resolvePreviewPath(dir, ["a", "b.css"])).toBe(
      "/tmp/preview-root/a/b.css",
    );
  });

  it("resolves the dir itself for empty segments", () => {
    expect(resolvePreviewPath(dir, [])).toBe("/tmp/preview-root");
  });

  it("rejects traversal outside the dir", () => {
    expect(resolvePreviewPath(dir, ["..", "etc", "passwd"])).toBeNull();
    expect(resolvePreviewPath(dir, ["a", "..", "..", "x"])).toBeNull();
  });

  it("neutralizes backslashes", () => {
    expect(resolvePreviewPath(dir, ["..\\evil"])).toBeNull();
  });
});
