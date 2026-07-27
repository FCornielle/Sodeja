import { describe, expect, it } from "vitest";
import { CostEstimator } from "./costEstimator.js";

describe("CostEstimator", () => {
  const estimator = new CostEstimator([
    { provider: "google-tiles", operation: "getTile", costPerCall: { amount: 0.005, currency: "USD" } },
    {
      provider: "google-geocoding",
      operation: "geocode",
      costPerCall: { amount: 0.5, currency: "DOP" },
    },
  ]);

  it("multiplies rate by call count per (provider, operation)", () => {
    const result = estimator.estimate([{ provider: "google-tiles", operation: "getTile", count: 100 }]);
    expect(result).toEqual([{ amount: 0.5, currency: "USD" }]);
  });

  it("sums across multiple usage records sharing a currency", () => {
    const result = estimator.estimate([
      { provider: "google-tiles", operation: "getTile", count: 100 },
      { provider: "google-tiles", operation: "getTile", count: 50 },
    ]);
    expect(result).toEqual([{ amount: 0.75, currency: "USD" }]);
  });

  it("keeps different currencies as separate totals", () => {
    const result = estimator.estimate([
      { provider: "google-tiles", operation: "getTile", count: 10 },
      { provider: "google-geocoding", operation: "geocode", count: 4 },
    ]);
    expect(result).toEqual(
      expect.arrayContaining([
        { amount: 0.05, currency: "USD" },
        { amount: 2, currency: "DOP" },
      ]),
    );
  });

  it("ignores usage with no matching configured rate", () => {
    const result = estimator.estimate([{ provider: "unknown-provider", operation: "op", count: 5 }]);
    expect(result).toEqual([]);
  });
});
