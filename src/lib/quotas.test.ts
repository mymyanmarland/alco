import { afterEach, describe, expect, it } from "vitest";
import {
  aiTokensDailyCap,
  parsePositiveInt,
  quotaResetAt,
  sandboxMinutesDailyCap,
  startOfToday,
  sumQuantities,
} from "./quotas";

const ENV_KEYS = ["AI_TOKENS_DAILY_CAP", "SANDBOX_MINUTES_DAILY_CAP"] as const;

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

describe("parsePositiveInt", () => {
  it("parses valid positive ints and floors", () => {
    expect(parsePositiveInt("100", 5)).toBe(100);
    expect(parsePositiveInt("99.9", 5)).toBe(99);
  });

  it("falls back on invalid, zero, negative, or missing values", () => {
    expect(parsePositiveInt("nope", 5)).toBe(5);
    expect(parsePositiveInt("0", 5)).toBe(5);
    expect(parsePositiveInt("-3", 5)).toBe(5);
    expect(parsePositiveInt("", 5)).toBe(5);
    expect(parsePositiveInt(undefined, 5)).toBe(5);
  });
});

describe("cap defaults and overrides", () => {
  const snap = snapshotEnv();
  afterEach(() => restoreEnv(snap));

  it("defaults to 200k AI tokens and 10 sandbox minutes", () => {
    delete process.env.AI_TOKENS_DAILY_CAP;
    delete process.env.SANDBOX_MINUTES_DAILY_CAP;
    expect(aiTokensDailyCap()).toBe(200_000);
    expect(sandboxMinutesDailyCap()).toBe(10);
  });

  it("honors env overrides", () => {
    process.env.AI_TOKENS_DAILY_CAP = "50000";
    process.env.SANDBOX_MINUTES_DAILY_CAP = "30";
    expect(aiTokensDailyCap()).toBe(50000);
    expect(sandboxMinutesDailyCap()).toBe(30);
  });
});

describe("sumQuantities", () => {
  it("sums numbers and treats null/undefined as 0", () => {
    expect(sumQuantities([1, 2, 3])).toBe(6);
    expect(sumQuantities([null, undefined, 5])).toBe(5);
    expect(sumQuantities([])).toBe(0);
  });
});

describe("startOfToday / quotaResetAt", () => {
  it("startOfToday zeroes the time", () => {
    const d = startOfToday(new Date("2026-10-18T15:30:00"));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it("quotaResetAt is the next midnight and a valid ISO string", () => {
    const reset = quotaResetAt(new Date("2026-10-18T15:30:00"));
    const d = new Date(reset);
    expect(d.getDate()).toBe(19);
    expect(d.getHours()).toBe(0);
    expect(Number.isNaN(d.getTime())).toBe(false);
  });
});
