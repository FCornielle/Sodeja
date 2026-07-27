import type { Logger } from "@sodeja/observability";
import type { Currency, Money } from "@sodeja/schemas";

export interface BillingAlertThreshold {
  currency: Currency;
  warnAt: number;
  criticalAt: number;
}

export type BillingAlertSeverity = "ok" | "warning" | "critical";

export interface BillingAlertResult {
  currency: Currency;
  amount: number;
  severity: BillingAlertSeverity;
}

/**
 * Local, configurable threshold logic only (risk F1's mitigation, "hard caps
 * + billing alerts") — this never calls a cloud billing API and never
 * disables a provider by itself. It logs via @sodeja/observability so a
 * threshold crossing is visible in stdout-json, which is as far as alerting
 * goes until a product-owner-approved paid provider and a real billing
 * integration exist.
 */
export class BillingAlertChecker {
  constructor(
    private readonly thresholds: BillingAlertThreshold[],
    private readonly logger?: Logger,
  ) {}

  check(estimates: Money[]): BillingAlertResult[] {
    return estimates.map((estimate) => {
      const threshold = this.thresholds.find((t) => t.currency === estimate.currency);
      let severity: BillingAlertSeverity = "ok";

      if (threshold) {
        if (estimate.amount >= threshold.criticalAt) {
          severity = "critical";
        } else if (estimate.amount >= threshold.warnAt) {
          severity = "warning";
        }
      }

      if (severity !== "ok") {
        this.logger?.warn(
          { currency: estimate.currency, amount: estimate.amount, severity },
          "billing alert threshold crossed",
        );
      }

      return { currency: estimate.currency, amount: estimate.amount, severity };
    });
  }
}
