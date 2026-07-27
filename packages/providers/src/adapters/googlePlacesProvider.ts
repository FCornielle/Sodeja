import { ProviderError } from "../errors.js";
import type { HealthCheckResult } from "../health.js";
import type { Place, PoiProvider, PoiSearchParams } from "../types.js";

interface GooglePlacesResponse {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    primaryType?: string;
    location: { latitude: number; longitude: number };
  }>;
}

/**
 * SODEJA_DATA_SOURCES.md: Google Places content may only be persisted as
 * `place_id` (indefinitely) and coordinates (<=30 days) — see
 * ephemeral.poi_provider_cache in specs/db/schema.sql. This adapter only
 * returns normalized results to its caller; it makes no storage decision.
 * Whoever persists this output (B-5) is responsible for the ephemeral-schema
 * TTL split, not this class.
 *
 * No fetch is attempted, and healthCheck() makes no network call, without
 * GOOGLE_MAPS_API_KEY present.
 */
export class GooglePlacesProvider implements PoiProvider {
  readonly name = "google-places";
  private static readonly API_KEY_ENV_VAR = "GOOGLE_MAPS_API_KEY";

  private getApiKey(): string | undefined {
    return process.env[GooglePlacesProvider.API_KEY_ENV_VAR];
  }

  async searchPlaces(params: PoiSearchParams): Promise<Place[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ProviderError({
        code: "NOT_CONFIGURED",
        provider: this.name,
        message: `${GooglePlacesProvider.API_KEY_ENV_VAR} is not set`,
      });
    }

    let response: Response;
    try {
      response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
        body: JSON.stringify({
          locationRestriction: {
            circle: {
              center: { latitude: params.lat, longitude: params.lon },
              radius: params.radiusM,
            },
          },
          includedTypes: params.category ? [params.category] : undefined,
        }),
      });
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

    const body = (await response.json()) as GooglePlacesResponse;
    return (body.places ?? []).map((place) => ({
      externalId: place.id,
      name: place.displayName?.text ?? "",
      category: place.primaryType,
      lat: place.location.latitude,
      lon: place.location.longitude,
    }));
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.getApiKey()) {
      return {
        provider: this.name,
        status: "unconfigured",
        detail: `${GooglePlacesProvider.API_KEY_ENV_VAR} is not set`,
      };
    }
    return { provider: this.name, status: "ok", detail: "configured (not network-probed)" };
  }
}
