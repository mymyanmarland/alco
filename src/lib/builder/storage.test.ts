import { describe, expect, it } from "vitest";
import { StorageError, validateFilePath } from "./storage";

describe("validateFilePath", () => {
  it("accepts normal relative paths and normalizes them", () => {
    expect(validateFilePath("index.html")).toBe("index.html");
    expect(validateFilePath("src/app/page.tsx")).toBe("src/app/page.tsx");
    expect(validateFilePath("./styles.css")).toBe("styles.css");
    expect(validateFilePath("a//b///c.js")).toBe("a/b/c.js");
  });

  it("converts backslashes and accepts the result", () => {
    expect(validateFilePath("src\\app\\x.ts")).toBe("src/app/x.ts");
  });

  it("rejects path traversal", () => {
    expect(() => validateFilePath("../evil.txt")).toThrow(StorageError);
    expect(() => validateFilePath("a/../../evil.txt")).toThrow(StorageError);
    expect(() => validateFilePath("..")).toThrow(StorageError);
    expect(() => validateFilePath("a/b/../../../x.js")).toThrow(StorageError);
  });

  it("rejects absolute paths", () => {
    expect(() => validateFilePath("/etc/passwd")).toThrow(StorageError);
    expect(() => validateFilePath("/index.html")).toThrow(StorageError);
  });

  it("rejects disallowed extensions", () => {
    expect(() => validateFilePath("run.sh")).toThrow(StorageError);
    expect(() => validateFilePath("app.exe")).toThrow(StorageError);
    expect(() => validateFilePath("data.bin")).toThrow(StorageError);
    expect(() => validateFilePath("noextension")).toThrow(StorageError);
  });

  it("is case-insensitive on extensions", () => {
    expect(validateFilePath("Page.TSX")).toBe("Page.TSX");
    expect(validateFilePath("doc.MD")).toBe("doc.MD");
  });

  it("rejects empty, blank, and over-long paths", () => {
    expect(() => validateFilePath("")).toThrow(StorageError);
    expect(() => validateFilePath("   ")).toThrow(StorageError);
    expect(() => validateFilePath("a".repeat(300) + ".txt")).toThrow(
      StorageError,
    );
  });

  it("rejects non-string input", () => {
    expect(() => validateFilePath(undefined as never)).toThrow(StorageError);
    expect(() => validateFilePath(null as never)).toThrow(StorageError);
  });

  it("rejects dot-only segments", () => {
    expect(() => validateFilePath(".")).toThrow(StorageError);
  });
});
