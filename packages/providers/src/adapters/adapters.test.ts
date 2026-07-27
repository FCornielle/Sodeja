import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleGeocodingProvider } from "./googleGeocodingProvider.js";
import { GooglePlacesProvider } from "./googlePlacesProvider.js";
import { createGoogleTilesProvider, createMapboxTilesProvider } from "./httpTileProvider.js";
import { LocalDirectoryTileProvider } from "./localDirectoryTileProvider.js";
import { MockGeocodingProvider, MockPoiProvider, MockTileProvider } from "./mockProviders.js";
import { OvertureLocalPoiProvider } from "./overtureLocalPoiProvider.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mock adapters", () => {
  it("MockTileProvider returns deterministic bytes and reports healthy", async () => {
    const provider = new MockTileProvider();
    const tile = await provider.getTile(1, 2, 3);
    expect(tile.toString()).toBe("mock-tile:1/2/3");
    expect(await provider.healthCheck()).toEqual({ provider: "mock-tiles", status: "ok" });
  });

  it("MockGeocodingProvider returns a deterministic result", async () => {
    const results = await new MockGeocodingProvider().geocode("Santo Domingo");
    expect(results).toHaveLength(1);
    expect(results[0]?.formattedAddress).toContain("Santo Domingo");
  });

  it("MockPoiProvider returns at least one deterministic place", async () => {
    const places = await new MockPoiProvider().searchPlaces();
    expect(places.length).toBeGreaterThan(0);
  });
});

describe("credentialed adapters without an API key", () => {
  it("google tiles: getTile throws NOT_CONFIGURED, healthCheck makes no network call", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", undefined);
    const provider = createGoogleTilesProvider();

    await expect(provider.getTile(1, 2, 3)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(await provider.healthCheck()).toMatchObject({ status: "unconfigured" });
  });

  it("mapbox tiles: same NOT_CONFIGURED/unconfigured posture", async () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", undefined);
    const provider = createMapboxTilesProvider();

    await expect(provider.getTile(1, 2, 3)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(await provider.healthCheck()).toMatchObject({ status: "unconfigured" });
  });

  it("google geocoding: geocode throws NOT_CONFIGURED without a key", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", undefined);
    const provider = new GoogleGeocodingProvider();

    await expect(provider.geocode("query")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(await provider.healthCheck()).toMatchObject({ status: "unconfigured" });
  });

  it("google places: searchPlaces throws NOT_CONFIGURED without a key", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", undefined);
    const provider = new GooglePlacesProvider();

    await expect(
      provider.searchPlaces({ lat: 18.48, lon: -69.93, radiusM: 500 }),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(await provider.healthCheck()).toMatchObject({ status: "unconfigured" });
  });

  it("never calls fetch when the API key is absent", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(new GoogleGeocodingProvider().geocode("x")).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("LocalDirectoryTileProvider", () => {
  it("reports NOT_CONFIGURED for a tile under a non-existent directory", async () => {
    const provider = new LocalDirectoryTileProvider("./this-directory-does-not-exist");
    await expect(provider.getTile(1, 2, 3)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(await provider.healthCheck()).toMatchObject({ status: "unconfigured" });
  });
});

describe("OvertureLocalPoiProvider", () => {
  it("reports NOT_CONFIGURED until B-5 wires the query layer", async () => {
    const provider = new OvertureLocalPoiProvider();
    await expect(provider.searchPlaces()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(await provider.healthCheck()).toMatchObject({ status: "unconfigured" });
  });
});
