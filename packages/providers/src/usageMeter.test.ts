import { describe, expect, it } from "vitest";
import { InMemoryUsageStore, UsageMeter } from "./usageMeter.js";

describe("InMemoryUsageStore", () => {
  it("counts records per (provider, operation) pair independently", () => {
    const store = new InMemoryUsageStore();
    store.record("google-tiles", "getTile");
    store.record("google-tiles", "getTile");
    store.record("google-geocoding", "geocode");

    expect(store.getUsage()).toEqual(
      expect.arrayContaining([
        { provider: "google-tiles", operation: "getTile", count: 2 },
        { provider: "google-geocoding", operation: "geocode", count: 1 },
      ]),
    );
  });

  it("filters by provider when requested", () => {
    const store = new InMemoryUsageStore();
    store.record("google-tiles", "getTile");
    store.record("mapbox-tiles", "getTile");

    expect(store.getUsage("mapbox-tiles")).toEqual([
      { provider: "mapbox-tiles", operation: "getTile", count: 1 },
    ]);
  });

  it("reset clears all counts", () => {
    const store = new InMemoryUsageStore();
    store.record("mock", "op");
    store.reset();
    expect(store.getUsage()).toEqual([]);
  });
});

describe("UsageMeter", () => {
  it("records a successful call", async () => {
    const meter = new UsageMeter();
    const result = await meter.track("mock", "op", async () => "ok");
    expect(result).toBe("ok");
    expect(meter.getUsage("mock")).toEqual([{ provider: "mock", operation: "op", count: 1 }]);
  });

  it("records a failed call too (the network request was still made)", async () => {
    const meter = new UsageMeter();
    await expect(
      meter.track("mock", "op", async () => {
        throw new Error("upstream 500");
      }),
    ).rejects.toThrow("upstream 500");
    expect(meter.getUsage("mock")).toEqual([{ provider: "mock", operation: "op", count: 1 }]);
  });
});
