import { ProviderError } from "../errors.js";
import type { HealthCheckResult } from "../health.js";
import type { GeocodingProvider, GeocodingResult } from "../types.js";

interface GoogleGeocodeResponse {
  results?: Array<{
    geometry: { location: { lat: number; lng: number } };
    formatted_address: string;
  }>;
}

/**
 * No fetch is attempted, and healthCheck() makes no network call, without
 * GOOGLE_MAPS_API_KEY present — see HttpTileProvider for the same posture on
 * the tiles side of this file.
 */
export class GoogleGeocodingProvider implements GeocodingProvider {
  readonly name = "google-geocoding";
  private static readonly API_KEY_ENV_VAR = "GOOGLE_MAPS_API_KEY";

  private getApiKey(): string | undefined {
    return process.env[GoogleGeocodingProvider.API_KEY_ENV_VAR];
  }

  async geocode(query: string): Promise<GeocodingResult[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ProviderError({
        code: "NOT_CONFIGURED",
        provider: this.name,
        message: `${GoogleGeocodingProvider.API_KEY_ENV_VAR} is not set`,
      });
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`;
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

    const body = (await response.json()) as GoogleGeocodeResponse;
    return (body.results ?? []).map((result) => ({
      lat: result.geometry.location.lat,
      lon: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
    }));
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.getApiKey()) {
      return {
        provider: this.name,
        status: "unconfigured",
        detail: `${GoogleGeocodingProvider.API_KEY_ENV_VAR} is not set`,
      };
    }
    return { provider: this.name, status: "ok", detail: "configured (not network-probed)" };
  }
}
