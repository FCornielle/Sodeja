import type { HealthCheckResult } from "../health.js";
import type { GeocodingProvider, GeocodingResult, Place, PoiProvider, TileProvider } from "../types.js";

/**
 * Deterministic, network-free implementations used as the default in
 * development and in every test that needs a provider without real
 * credentials. Kept in one file because each is a handful of lines with the
 * same shape — a real adapter per provider lives in its own file instead.
 */
export class MockTileProvider implements TileProvider {
  readonly name = "mock-tiles";

  async getTile(z: number, x: number, y: number): Promise<Buffer> {
    return Buffer.from(`mock-tile:${z}/${x}/${y}`);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { provider: this.name, status: "ok" };
  }
}

export class MockGeocodingProvider implements GeocodingProvider {
  readonly name = "mock-geocoding";

  async geocode(query: string): Promise<GeocodingResult[]> {
    return [
      {
        lat: 18.4861,
        lon: -69.9312,
        formattedAddress: `Mock result for "${query}"`,
      },
    ];
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { provider: this.name, status: "ok" };
  }
}

export class MockPoiProvider implements PoiProvider {
  readonly name = "mock-poi";

  async searchPlaces(): Promise<Place[]> {
    return [{ externalId: "mock-1", name: "Colmado Mock", category: "colmado", lat: 18.4861, lon: -69.9312 }];
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { provider: this.name, status: "ok" };
  }
}
