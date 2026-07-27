import { describe, expect, it } from "vitest";
import { DualRateLimiter, RateLimiter } from "./rateLimiter.js";

describe("RateLimiter", () => {
  it("allows calls up to the limit within the window", () => {
    const now = 0;
    const limiter = new RateLimiter({ limit: 3, windowMs: 1000 }, () => now);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
  });

  it("tracks separate keys independently", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("b")).toBe(true);
    expect(limiter.check("a")).toBe(false);
  });

  it("resets the window after windowMs elapses", () => {
    let now = 0;
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 }, () => now);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    now = 1001;
    expect(limiter.check("a")).toBe(true);
  });

  it("reset() clears a key's window immediately", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    limiter.reset("a");
    expect(limiter.check("a")).toBe(true);
  });
});

describe("DualRateLimiter", () => {
  it("passes when both per-user and per-IP are within limits", () => {
    const limiter = new DualRateLimiter(
      new RateLimiter({ limit: 5, windowMs: 1000 }),
      new RateLimiter({ limit: 5, windowMs: 1000 }),
    );
    expect(() => limiter.checkOrThrow("tiles", { userId: "u1", ip: "1.2.3.4" })).not.toThrow();
  });

  it("throws RATE_LIMITED when the per-user limit is exceeded", () => {
    const limiter = new DualRateLimiter(
      new RateLimiter({ limit: 1, windowMs: 1000 }),
      new RateLimiter({ limit: 100, windowMs: 1000 }),
    );
    limiter.checkOrThrow("tiles", { userId: "u1", ip: "1.2.3.4" });
    expect(() => limiter.checkOrThrow("tiles", { userId: "u1", ip: "5.6.7.8" })).toThrow(
      /Rate limit exceeded for user/,
    );
  });

  it("throws RATE_LIMITED when the per-IP limit is exceeded, even for different users", () => {
    const limiter = new DualRateLimiter(
      new RateLimiter({ limit: 100, windowMs: 1000 }),
      new RateLimiter({ limit: 1, windowMs: 1000 }),
    );
    limiter.checkOrThrow("tiles", { userId: "u1", ip: "1.2.3.4" });
    expect(() => limiter.checkOrThrow("tiles", { userId: "u2", ip: "1.2.3.4" })).toThrow(
      /Rate limit exceeded for IP/,
    );
  });

  it("enforces the per-IP limit even with no userId (anonymous caller)", () => {
    const limiter = new DualRateLimiter(
      new RateLimiter({ limit: 100, windowMs: 1000 }),
      new RateLimiter({ limit: 1, windowMs: 1000 }),
    );
    limiter.checkOrThrow("tiles", { ip: "9.9.9.9" });
    expect(() => limiter.checkOrThrow("tiles", { ip: "9.9.9.9" })).toThrow(
      /Rate limit exceeded for IP/,
    );
  });
});
