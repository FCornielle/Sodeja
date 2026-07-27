import type { HealthCheckable } from "./health.js";

export interface TileProvider extends HealthCheckable {
  readonly name: string;
  getTile(z: number, x: number, y: number): Promise<Buffer>;
}

export interface GeocodingResult {
  lat: number;
  lon: number;
  formattedAddress: string;
}

export interface GeocodingProvider extends HealthCheckable {
  readonly name: string;
  geocode(query: string): Promise<GeocodingResult[]>;
}

export interface Place {
  externalId: string;
  name: string;
  category?: string;
  lat: number;
  lon: number;
}

export interface PoiSearchParams {
  lat: number;
  lon: number;
  radiusM: number;
  category?: string;
}

export interface PoiProvider extends HealthCheckable {
  readonly name: string;
  searchPlaces(params: PoiSearchParams): Promise<Place[]>;
}
