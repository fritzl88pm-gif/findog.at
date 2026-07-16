import { describe, expect, it } from "vitest";

import {
  FRED_RATE_LIMIT_WINDOW_MS,
  FRED_RATE_LIMIT_MAX_REQUESTS,
  createRateLimiter,
} from "./rate-limit";

describe("Fred rate limiter", () => {
  it("exports configured constants", () => {
    expect(FRED_RATE_LIMIT_WINDOW_MS).toBeGreaterThan(0);
    expect(FRED_RATE_LIMIT_MAX_REQUESTS).toBeGreaterThan(0);
  });

  it("allows requests within the limit", () => {
    const limiter = createRateLimiter();
    const userId = "user-1";

    for (let i = 0; i < FRED_RATE_LIMIT_MAX_REQUESTS; i++) {
      expect(limiter.check(userId)).toBe(true);
    }
  });

  it("blocks requests exceeding the limit", () => {
    const limiter = createRateLimiter();
    const userId = "user-2";

    for (let i = 0; i < FRED_RATE_LIMIT_MAX_REQUESTS; i++) {
      limiter.check(userId);
    }

    expect(limiter.check(userId)).toBe(false);
  });

  it("resets after the window expires", () => {
    let fakeNow = 1000;
    const limiter = createRateLimiter({
      windowMs: 1000,
      maxRequests: 2,
      nowFn: () => fakeNow,
    });
    const userId = "user-3";

    expect(limiter.check(userId)).toBe(true);
    expect(limiter.check(userId)).toBe(true);
    expect(limiter.check(userId)).toBe(false);

    // Advance time past the window
    fakeNow += 1001;

    expect(limiter.check(userId)).toBe(true);
  });

  it("tracks different users independently", () => {
    const limiter = createRateLimiter({ maxRequests: 1 });
    const userA = "user-a";
    const userB = "user-b";

    expect(limiter.check(userA)).toBe(true);
    expect(limiter.check(userA)).toBe(false);
    expect(limiter.check(userB)).toBe(true);
    expect(limiter.check(userB)).toBe(false);
  });
});
