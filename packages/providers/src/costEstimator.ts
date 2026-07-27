import type { Currency, Money } from "@sodeja/schemas";
import type { UsageSnapshot } from "./usageMeter.js";

export interface CostRate {
  provider: string;
  operation: string;
  costPerCall: Money;
}

/**
 * Purely internal arithmetic: usage counts times a configured per-call rate.
 * No billing API is called and no real spend is incurred anywhere in this
 * class — it exists so B-3's alerting has a number to threshold against
 * ahead of any real provider being enabled (risk F1).
 */
export class CostEstimator {
  constructor(private readonly rates: CostRate[]) {}

  estimate(usage: UsageSnapshot[]): Money[] {
    const totalsByCurrency = new Map<Currency, number>();

    for (const record of usage) {
      const rate = this.rates.find(
        (r) => r.provider === record.provider && r.operation === record.operation,
      );
      if (!rate) continue;
      const currency = rate.costPerCall.currency;
      const amount = rate.costPerCall.amount * record.count;
      totalsByCurrency.set(currency, (totalsByCurrency.get(currency) ?? 0) + amount);
    }

    return [...totalsByCurrency.entries()].map(([currency, amount]) => ({ amount, currency }));
  }
}
