import { describe, expect, it } from "vitest";
import { aggregateHealth, type HealthCheckable } from "./health.js";

describe("aggregateHealth", () => {
  it("collects health results from every checkable", async () => {
    const ok: HealthCheckable = {
      healthCheck: async () => ({ provider: "mock-tiles", status: "ok" }),
    };
    const unconfigured: HealthCheckable = {
      healthCheck: async () => ({
        provider: "google-tiles",
        status: "unconfigured",
        detail: "GOOGLE_MAPS_API_KEY not set",
      }),
    };

    const results = await aggregateHealth([ok, unconfigured]);

    expect(results).toEqual([
      { provider: "mock-tiles", status: "ok" },
      { provider: "google-tiles", status: "unconfigured", detail: "GOOGLE_MAPS_API_KEY not set" },
    ]);
  });

  it("returns an empty array for no checkables", async () => {
    expect(await aggregateHealth([])).toEqual([]);
  });
});
