import { afterEach, describe, expect, it } from "vitest";
import { adminEmails, isAdminEmail } from "./admin";

const KEY = "ADMIN_EMAILS";

function snapshot(): string | undefined {
  return process.env[KEY];
}

function restore(v: string | undefined): void {
  if (v === undefined) delete process.env[KEY];
  else process.env[KEY] = v;
}

describe("admin email matching", () => {
  const snap = snapshot();
  afterEach(() => restore(snap));

  it("parses comma-separated emails case-insensitively", () => {
    process.env[KEY] = " Admin@Example.com ,ops@example.com,";
    expect(adminEmails()).toEqual(["admin@example.com", "ops@example.com"]);
    expect(isAdminEmail("ADMIN@example.com")).toBe(true);
    expect(isAdminEmail("ops@example.com")).toBe(true);
  });

  it("rejects non-listed emails and empty config", () => {
    process.env[KEY] = "admin@example.com";
    expect(isAdminEmail("user@example.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    delete process.env[KEY];
    expect(adminEmails()).toEqual([]);
    expect(isAdminEmail("admin@example.com")).toBe(false);
  });
});
