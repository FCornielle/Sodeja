import { ProviderError } from "../errors.js";
import type { HealthCheckResult } from "../health.js";
import type { TileProvider } from "../types.js";

export interface HttpTileProviderConfig {
  name: string;
  apiKeyEnvVar: string;
  buildUrl: (params: { z: number; x: number; y: number; apiKey: string }) => string;
}

/**
 * Shared shape for every credentialed tile provider (Google, Mapbox,
 * MapTiler — SODEJA_ARCHITECTURE.md lists all three as the paid fallback if
 * self-hosted PMTiles/Overture coverage proves insufficient). No fetch is
 * ever attempted without an API key present: this throws NOT_CONFIGURED, and
 * healthCheck() never makes a network call. Nothing in this class can incur
 * cost or contact a paid API before a product-owner-approved key exists in
 * the environment.
 *
 * Google's own Maps Tiles API additionally requires a session-token exchange
 * this generic buildUrl-based shape does not model; wiring a real Google
 * adapter is expected to need a small follow-up once a key is approved, not
 * a rewrite of this class.
 */
export class HttpTileProvider implements TileProvider {
  readonly name: string;

  constructor(private readonly config: HttpTileProviderConfig) {
    this.name = config.name;
  }

  private getApiKey(): string | undefined {
    return process.env[this.config.apiKeyEnvVar];
  }

  async getTile(z: number, x: number, y: number): Promise<Buffer> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ProviderError({
        code: "NOT_CONFIGURED",
        provider: this.name,
        message: `${this.config.apiKeyEnvVar} is not set`,
      });
    }

    const url = this.config.buildUrl({ z, x, y, apiKey });
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new ProviderError({
        code: "UPSTREAM_ERROR",
        provider: this.name,
        message: `${this.name} request failed`,
        cause: error,
      });
    }

    if (!response.ok) {
      throw new ProviderError({
        code: "UPSTREAM_ERROR",
        provider: this.name,
        message: `${this.name} returned HTTP ${response.status}`,
      });
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.getApiKey()) {
      return {
        provider: this.name,
        status: "unconfigured",
        detail: `${this.config.apiKeyEnvVar} is not set`,
      };
    }
    return { provider: this.name, status: "ok", detail: "configured (not network-probed)" };
  }
}

export function createGoogleTilesProvider(): HttpTileProvider {
  return new HttpTileProvider({
    name: "google-tiles",
    apiKeyEnvVar: "GOOGLE_MAPS_API_KEY",
    buildUrl: ({ z, x, y, apiKey }) =>
      `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?key=${apiKey}`,
  });
}

export function createMapboxTilesProvider(): HttpTileProvider {
  return new HttpTileProvider({
    name: "mapbox-tiles",
    apiKeyEnvVar: "MAPBOX_ACCESS_TOKEN",
    buildUrl: ({ z, x, y, apiKey }) =>
      `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/${z}/${x}/${y}.mvt?access_token=${apiKey}`,
  });
}

export function createMapTilerTilesProvider(): HttpTileProvider {
  return new HttpTileProvider({
    name: "maptiler-tiles",
    apiKeyEnvVar: "MAPTILER_API_KEY",
    buildUrl: ({ z, x, y, apiKey }) => `https://api.maptiler.com/tiles/v3/${z}/${x}/${y}.pbf?key=${apiKey}`,
  });
}
