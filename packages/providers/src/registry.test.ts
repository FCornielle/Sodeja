import { describe, expect, it } from "vitest";
import { createGeocodingProvider, createPoiProvider, createTileProvider } from "./registry.js";

describe("createTileProvider", () => {
  it("selects the mock adapter when TILE_PROVIDER=mock", () => {
    expect(createTileProvider({ TILE_PROVIDER: "mock" }).name).toBe("mock-tiles");
  });

  it("selects google when TILE_PROVIDER=google", () => {
    expect(createTileProvider({ TILE_PROVIDER: "google" }).name).toBe("google-tiles");
  });

  it("selects mapbox when TILE_PROVIDER=mapbox", () => {
    expect(createTileProvider({ TILE_PROVIDER: "mapbox" }).name).toBe("mapbox-tiles");
  });

  it("selects maptiler when TILE_PROVIDER=maptiler", () => {
    expect(createTileProvider({ TILE_PROVIDER: "maptiler" }).name).toBe("maptiler-tiles");
  });

  it("defaults to pmtiles-local when TILE_PROVIDER is unset", () => {
    expect(createTileProvider({}).name).toBe("pmtiles-local");
  });

  it("throws NOT_CONFIGURED for an unrecognized value", () => {
    expect(() => createTileProvider({ TILE_PROVIDER: "not-a-real-provider" })).toThrow(
      /Unknown TILE_PROVIDER/,
    );
  });
});

describe("createGeocodingProvider", () => {
  it("defaults to mock when GEOCODING_PROVIDER is unset", () => {
    expect(createGeocodingProvider({}).name).toBe("mock-geocoding");
  });

  it("selects google when GEOCODING_PROVIDER=google", () => {
    expect(createGeocodingProvider({ GEOCODING_PROVIDER: "google" }).name).toBe("google-geocoding");
  });

  it("throws NOT_CONFIGURED for an unrecognized value", () => {
    expect(() => createGeocodingProvider({ GEOCODING_PROVIDER: "bogus" })).toThrow(
      /Unknown GEOCODING_PROVIDER/,
    );
  });
});

describe("createPoiProvider", () => {
  it("defaults to overture-local when POI_PROVIDER is unset", () => {
    expect(createPoiProvider({}).name).toBe("overture-local");
  });

  it("selects mock when POI_PROVIDER=mock", () => {
    expect(createPoiProvider({ POI_PROVIDER: "mock" }).name).toBe("mock-poi");
  });

  it("selects google when POI_PROVIDER=google", () => {
    expect(createPoiProvider({ POI_PROVIDER: "google" }).name).toBe("google-places");
  });

  it("throws NOT_CONFIGURED for an unrecognized value", () => {
    expect(() => createPoiProvider({ POI_PROVIDER: "bogus" })).toThrow(/Unknown POI_PROVIDER/);
  });
});
