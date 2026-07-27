import { describe, expect, it, vi } from "vitest";
import { BillingAlertChecker } from "./billingAlerts.js";

describe("BillingAlertChecker", () => {
  it("reports 'ok' below the warning threshold", () => {
    const checker = new BillingAlertChecker([{ currency: "USD", warnAt: 10, criticalAt: 20 }]);
    expect(checker.check([{ amount: 5, currency: "USD" }])).toEqual([
      { currency: "USD", amount: 5, severity: "ok" },
    ]);
  });

  it("reports 'warning' at or above warnAt but below criticalAt", () => {
    const checker = new BillingAlertChecker([{ currency: "USD", warnAt: 10, criticalAt: 20 }]);
    expect(checker.check([{ amount: 12, currency: "USD" }])).toEqual([
      { currency: "USD", amount: 12, severity: "warning" },
    ]);
  });

  it("reports 'critical' at or above criticalAt", () => {
    const checker = new BillingAlertChecker([{ currency: "USD", warnAt: 10, criticalAt: 20 }]);
    expect(checker.check([{ amount: 25, currency: "USD" }])).toEqual([
      { currency: "USD", amount: 25, severity: "critical" },
    ]);
  });

  it("reports 'ok' for a currency with no configured threshold", () => {
    const checker = new BillingAlertChecker([{ currency: "USD", warnAt: 10, criticalAt: 20 }]);
    expect(checker.check([{ amount: 1_000_000, currency: "DOP" }])).toEqual([
      { currency: "DOP", amount: 1_000_000, severity: "ok" },
    ]);
  });

  it("logs a warning through the injected logger when a threshold is crossed", () => {
    const logger = { warn: vi.fn() } as unknown as { warn: (...args: unknown[]) => void };
    const checker = new BillingAlertChecker(
      [{ currency: "USD", warnAt: 10, criticalAt: 20 }],
      logger as never,
    );

    checker.check([{ amount: 15, currency: "USD" }]);

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("never calls the logger when everything is 'ok'", () => {
    const logger = { warn: vi.fn() } as unknown as { warn: (...args: unknown[]) => void };
    const checker = new BillingAlertChecker(
      [{ currency: "USD", warnAt: 10, criticalAt: 20 }],
      logger as never,
    );

    checker.check([{ amount: 1, currency: "USD" }]);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
