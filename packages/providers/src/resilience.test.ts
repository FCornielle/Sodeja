import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "./errors.js";
import { CircuitBreaker, withRetry, withTimeout } from "./resilience.js";

describe("withTimeout", () => {
  it("resolves normally when the function finishes in time", async () => {
    const result = await withTimeout("mock", 50, async () => "ok");
    expect(result).toBe("ok");
  });

  it("throws a TIMEOUT ProviderError when the function does not finish in time", async () => {
    await expect(
      withTimeout(
        "slow-provider",
        20,
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT", provider: "slow-provider" });
  });

  it("times out a callee that never settles and never observes the abort signal", async () => {
    // TileProvider/GeocodingProvider's real interface takes no AbortSignal at
    // all, so this is the actual shape withTimeout must handle, not just the
    // cooperative case above.
    await expect(
      withTimeout("uncooperative-provider", 20, () => new Promise(() => {})),
    ).rejects.toMatchObject({ code: "TIMEOUT", provider: "uncooperative-provider" });
  });
});

describe("withRetry", () => {
  it("returns the result on the first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry("mock", { maxAttempts: 3, baseDelayMs: 1, sleep: async () => {} }, fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on a retryable error and eventually succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError({ code: "TIMEOUT", provider: "x", message: "m" }))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(
      "x",
      { maxAttempts: 3, baseDelayMs: 1, sleep: async () => {}, jitter: () => 0 },
      fn,
    );

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a RATE_LIMITED error", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new ProviderError({ code: "RATE_LIMITED", provider: "x", message: "m" }));

    await expect(
      withRetry("x", { maxAttempts: 3, baseDelayMs: 1, sleep: async () => {} }, fn),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a CIRCUIT_OPEN error", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new ProviderError({ code: "CIRCUIT_OPEN", provider: "x", message: "m" }));

    await expect(
      withRetry("x", { maxAttempts: 3, baseDelayMs: 1, sleep: async () => {} }, fn),
    ).rejects.toMatchObject({ code: "CIRCUIT_OPEN" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts and surfaces the last error", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(
        new ProviderError({ code: "UPSTREAM_ERROR", provider: "x", message: "still failing" }),
      );

    await expect(
      withRetry("x", { maxAttempts: 3, baseDelayMs: 1, sleep: async () => {} }, fn),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR", message: "still failing" });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("CircuitBreaker", () => {
  it("stays closed and passes through results while calls succeed", async () => {
    const breaker = new CircuitBreaker("x", { failureThreshold: 2, resetTimeoutMs: 1000 });
    expect(await breaker.execute(async () => "ok")).toBe("ok");
    expect(breaker.getState()).toBe("closed");
  });

  it("opens after the failure threshold and fails fast without calling the function", async () => {
    const breaker = new CircuitBreaker("x", { failureThreshold: 2, resetTimeoutMs: 1000 });
    const failing = () => Promise.reject(new Error("boom"));

    await expect(breaker.execute(failing)).rejects.toBeTruthy();
    await expect(breaker.execute(failing)).rejects.toBeTruthy();
    expect(breaker.getState()).toBe("open");

    const fn = vi.fn().mockResolvedValue("should not run");
    await expect(breaker.execute(fn)).rejects.toMatchObject({ code: "CIRCUIT_OPEN" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("allows one trial call after resetTimeoutMs and closes on success", async () => {
    let now = 0;
    const breaker = new CircuitBreaker("x", {
      failureThreshold: 1,
      resetTimeoutMs: 100,
      now: () => now,
    });

    await expect(breaker.execute(() => Promise.reject(new Error("boom")))).rejects.toBeTruthy();
    expect(breaker.getState()).toBe("open");

    now += 100;
    expect(breaker.getState()).toBe("half_open");

    const result = await breaker.execute(async () => "recovered");
    expect(result).toBe("recovered");
    expect(breaker.getState()).toBe("closed");
  });

  it("re-opens immediately if the half-open trial call also fails", async () => {
    let now = 0;
    const breaker = new CircuitBreaker("x", {
      failureThreshold: 1,
      resetTimeoutMs: 100,
      now: () => now,
    });

    await expect(breaker.execute(() => Promise.reject(new Error("boom")))).rejects.toBeTruthy();
    now += 100;
    expect(breaker.getState()).toBe("half_open");

    await expect(breaker.execute(() => Promise.reject(new Error("still broken")))).rejects.toBeTruthy();
    expect(breaker.getState()).toBe("open");
  });
});
