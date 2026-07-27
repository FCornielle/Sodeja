import { describe, expect, it } from "vitest";
import { normalizeError, ProviderError } from "./errors.js";

describe("ProviderError", () => {
  it("marks TIMEOUT and UPSTREAM_ERROR as retryable", () => {
    expect(new ProviderError({ code: "TIMEOUT", provider: "x", message: "m" }).retryable).toBe(
      true,
    );
    expect(
      new ProviderError({ code: "UPSTREAM_ERROR", provider: "x", message: "m" }).retryable,
    ).toBe(true);
  });

  it("marks RATE_LIMITED, CIRCUIT_OPEN, NOT_CONFIGURED, UNKNOWN as not retryable", () => {
    for (const code of ["RATE_LIMITED", "CIRCUIT_OPEN", "NOT_CONFIGURED", "UNKNOWN"] as const) {
      expect(new ProviderError({ code, provider: "x", message: "m" }).retryable).toBe(false);
    }
  });

  it("toSafeJSON never includes the cause", () => {
    const secretCause = new Error("upstream said: key=super-secret-value");
    const error = new ProviderError({
      code: "UPSTREAM_ERROR",
      provider: "google-tiles",
      message: "upstream failed",
      cause: secretCause,
    });

    const safe = error.toSafeJSON();
    const serialized = JSON.stringify(safe);

    expect(serialized).not.toContain("super-secret-value");
    expect(safe).toEqual({
      code: "UPSTREAM_ERROR",
      provider: "google-tiles",
      message: "upstream failed",
      retryable: true,
    });
  });
});

describe("normalizeError", () => {
  it("passes an existing ProviderError through unchanged", () => {
    const original = new ProviderError({ code: "NOT_CONFIGURED", provider: "x", message: "m" });
    expect(normalizeError("x", original)).toBe(original);
  });

  it("maps an AbortError to TIMEOUT", () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const normalized = normalizeError("google-geocoding", abortError);
    expect(normalized.code).toBe("TIMEOUT");
  });

  it("maps an unrecognized error to UNKNOWN without leaking it via toSafeJSON", () => {
    const normalized = normalizeError("mock", new Error("boom with secret=abc123"));
    expect(normalized.code).toBe("UNKNOWN");
    expect(JSON.stringify(normalized.toSafeJSON())).not.toContain("abc123");
  });
});
