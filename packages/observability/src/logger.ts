import pino, { type Logger as PinoLogger } from "pino";

export type Logger = PinoLogger;

/**
 * Only driver implemented in Phase 1 (SODEJA_ARCHITECTURE.md "Infrastructure
 * posture" — free/local first, no paid error-tracking plan without explicit
 * product-owner approval). apps/api/README.md documents this as the
 * TELEMETRY_DRIVER seam; a Sentry-backed driver is a Phase 2+ addition behind
 * the same interface, not a rewrite.
 */
const SUPPORTED_DRIVERS = ["stdout-json"] as const;
export type TelemetryDriver = (typeof SUPPORTED_DRIVERS)[number];

export function resolveTelemetryDriver(): TelemetryDriver {
  const requested = process.env.TELEMETRY_DRIVER ?? "stdout-json";
  if (!SUPPORTED_DRIVERS.includes(requested as TelemetryDriver)) {
    throw new Error(
      `Unsupported TELEMETRY_DRIVER "${requested}". Only ${SUPPORTED_DRIVERS.join(", ")} is implemented in Phase 1.`,
    );
  }
  return requested as TelemetryDriver;
}

export function createLogger(name: string): Logger {
  resolveTelemetryDriver();
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
