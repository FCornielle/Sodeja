import {
  createGoogleTilesProvider,
  createMapboxTilesProvider,
  createMapTilerTilesProvider,
} from "./adapters/httpTileProvider.js";
import { GoogleGeocodingProvider } from "./adapters/googleGeocodingProvider.js";
import { GooglePlacesProvider } from "./adapters/googlePlacesProvider.js";
import { LocalDirectoryTileProvider } from "./adapters/localDirectoryTileProvider.js";
import { MockGeocodingProvider, MockPoiProvider, MockTileProvider } from "./adapters/mockProviders.js";
import { OvertureLocalPoiProvider } from "./adapters/overtureLocalPoiProvider.js";
import { ProviderError } from "./errors.js";
import type { GeocodingProvider, PoiProvider, TileProvider } from "./types.js";

/**
 * Every factory reads its provider choice from a single env var — the seam
 * documented in apps/api/README.md (TILE_PROVIDER, POI_PROVIDER) plus
 * GEOCODING_PROVIDER (new in B-3). Switching a provider is always a config
 * change here, never a code change at any call site.
 */
export function createTileProvider(env: NodeJS.ProcessEnv = process.env): TileProvider {
  const selected = env.TILE_PROVIDER ?? "pmtiles-local";
  switch (selected) {
    case "mock":
      return new MockTileProvider();
    case "pmtiles-local":
      return new LocalDirectoryTileProvider(env.TILES_LOCAL_DIR ?? "./data/tiles");
    case "google":
      return createGoogleTilesProvider();
    case "mapbox":
      return createMapboxTilesProvider();
    case "maptiler":
      return createMapTilerTilesProvider();
    default:
      throw new ProviderError({
        code: "NOT_CONFIGURED",
        provider: "tile-registry",
        message: `Unknown TILE_PROVIDER "${selected}"`,
      });
  }
}

export function createGeocodingProvider(env: NodeJS.ProcessEnv = process.env): GeocodingProvider {
  const selected = env.GEOCODING_PROVIDER ?? "mock";
  switch (selected) {
    case "mock":
      return new MockGeocodingProvider();
    case "google":
      return new GoogleGeocodingProvider();
    default:
      throw new ProviderError({
        code: "NOT_CONFIGURED",
        provider: "geocoding-registry",
        message: `Unknown GEOCODING_PROVIDER "${selected}"`,
      });
  }
}

export function createPoiProvider(env: NodeJS.ProcessEnv = process.env): PoiProvider {
  const selected = env.POI_PROVIDER ?? "overture-local";
  switch (selected) {
    case "mock":
      return new MockPoiProvider();
    case "overture-local":
      return new OvertureLocalPoiProvider();
    case "google":
      return new GooglePlacesProvider();
    default:
      throw new ProviderError({
        code: "NOT_CONFIGURED",
        provider: "poi-registry",
        message: `Unknown POI_PROVIDER "${selected}"`,
      });
  }
}
