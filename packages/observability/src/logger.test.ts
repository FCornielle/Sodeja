import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, resolveTelemetryDriver } from "./logger.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveTelemetryDriver", () => {
  it("defaults to stdout-json when TELEMETRY_DRIVER is unset", () => {
    vi.stubEnv("TELEMETRY_DRIVER", undefined);
    expect(resolveTelemetryDriver()).toBe("stdout-json");
  });

  it("rejects a driver not implemented in Phase 1", () => {
    vi.stubEnv("TELEMETRY_DRIVER", "sentry");
    expect(() => resolveTelemetryDriver()).toThrow(/Unsupported TELEMETRY_DRIVER/);
  });
});

describe("createLogger", () => {
  it("returns a pino logger instance", () => {
    const logger = createLogger("test");
    expect(typeof logger.info).toBe("function");
  });
});
