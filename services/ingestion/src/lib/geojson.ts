/**
 * Minimal local GeoJSON types — only the shapes this package actually
 * consumes (Polygon/MultiPolygon geometries and FeatureCollections of them).
 * Not a general-purpose GeoJSON typing; avoids pulling in @types/geojson for
 * two structural interfaces.
 */
export interface PolygonGeometry {
  type: "Polygon";
  coordinates: number[][][];
}

export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

export type PolygonalGeometry = PolygonGeometry | MultiPolygonGeometry;

export interface GeoJsonFeature<
  P extends Record<string, unknown> = Record<string, unknown>,
  G = PolygonalGeometry,
> {
  type: "Feature";
  properties: P;
  geometry: G;
}

export interface GeoJsonFeatureCollection<
  P extends Record<string, unknown> = Record<string, unknown>,
  G = PolygonalGeometry,
> {
  type: "FeatureCollection";
  features: GeoJsonFeature<P, G>[];
}
