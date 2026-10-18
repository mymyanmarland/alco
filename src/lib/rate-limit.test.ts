import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter } from "./rate-limit";

describe("SlidingWindowLimiter", () => {
  it("allows up to the limit within the window", () => {
    const now = 1_000;
    const limiter = new SlidingWindowLimiter(() => now);
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("k", 5, 60_000).ok).toBe(true);
    }
    const verdict = limiter.check("k", 5, 60_000);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.retryAfterMs).toBeGreaterThan(0);
      expect(verdict.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it("slides: old hits expire and new ones are allowed", () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(() => now);
    expect(limiter.check("k", 1, 1_000).ok).toBe(true);
    expect(limiter.check("k", 1, 1_000).ok).toBe(false);
    now = 1_001; // window moved past the first hit
    expect(limiter.check("k", 1, 1_000).ok).toBe(true);
  });

  it("tracks keys independently", () => {
    const limiter = new SlidingWindowLimiter(() => 0);
    expect(limiter.check("a", 1, 60_000).ok).toBe(true);
    expect(limiter.check("a", 1, 60_000).ok).toBe(false);
    expect(limiter.check("b", 1, 60_000).ok).toBe(true);
  });

  it("reset() clears all buckets", () => {
    const limiter = new SlidingWindowLimiter(() => 0);
    expect(limiter.check("k", 1, 60_000).ok).toBe(true);
    limiter.reset();
    expect(limiter.check("k", 1, 60_000).ok).toBe(true);
  });
});
