import type { GeoJsonFeature, PolygonGeometry } from "../lib/geojson.js";
import { parseWktPolygon } from "../lib/wkt.js";

/** Matches geo.building_footprint.source's CHECK constraint exactly. */
export type FootprintSource = "open_buildings_v3" | "ms_globalml" | "overture" | "osm";

export interface FootprintRow {
  geometry: PolygonGeometry;
  /** Detection confidence in [0, 1], or null if the source doesn't report one. */
  confidence: number | null;
  source: FootprintSource;
  sourceLicense: string;
  sourceVintage: string; // ISO date
}

export const MS_GLOBALML_SOURCE: FootprintSource = "ms_globalml";
export const MS_GLOBALML_LICENSE = "CDLA-Permissive-2.0";
// Build date confirmed for the DominicanRepublic region in dataset-links.csv
// (docs/SODEJA_DATA_SOURCES.md: "build date 2026-02-03").
export const MS_GLOBALML_VINTAGE = "2026-02-03";

export const OPEN_BUILDINGS_SOURCE: FootprintSource = "open_buildings_v3";
// Dual-licensed CC BY 4.0 / ODbL v1.0 (docs/SODEJA_DATA_SOURCES.md); CC BY 4.0
// is selected here rather than ODbL — SODEJA_ARCHITECTURE.md's licensing
// boundary section flags ODbL's share-alike obligation as needing legal
// review before use, whereas CC BY is attribution-only and unambiguous for
// the storable `geo` tier this job writes to.
export const OPEN_BUILDINGS_LICENSE = "CC-BY-4.0";
// Google's published inference date for V3 ("May 2023" per
// docs/SODEJA_DATA_SOURCES.md); day-of-month is not published, so the first
// of the month is used as a documented placeholder, not a precise date.
export const OPEN_BUILDINGS_VINTAGE = "2023-05-01";

interface MsGlobalMlProperties {
  height: number;
  confidence: number;
  [key: string]: unknown;
}

/**
 * Confidence of -1 is Microsoft's "not applicable" sentinel in this export
 * (observed directly in a real downloaded DominicanRepublic tile — every
 * row in the 2026-02-03 build reports height: -1.0, confidence: -1.0).
 * geo.building_footprint.confidence has a `BETWEEN 0 AND 1` CHECK, so any
 * value outside that range — not just -1 specifically — is mapped to NULL
 * rather than rejected, in case a future MS build starts reporting real
 * confidence scores with occasional out-of-range noise.
 */
function normalizeConfidence(value: number): number | null {
  return value >= 0 && value <= 1 ? value : null;
}

export function mapMsGlobalMlFeature(
  feature: GeoJsonFeature<MsGlobalMlProperties, PolygonGeometry>,
): FootprintRow {
  if (feature.geometry.type !== "Polygon") {
    throw new Error(`Expected MS GlobalML feature geometry to be Polygon, got ${feature.geometry.type}`);
  }
  return {
    geometry: feature.geometry,
    confidence: normalizeConfidence(feature.properties.confidence),
    source: MS_GLOBALML_SOURCE,
    sourceLicense: MS_GLOBALML_LICENSE,
    sourceVintage: MS_GLOBALML_VINTAGE,
  };
}

/**
 * Google's documented Open Buildings V3 per-building CSV columns:
 * latitude, longitude, area_in_meters, confidence, geometry, full_plus_code.
 * `area_in_meters` is deliberately NOT used — area_sqm is always computed by
 * this job's own ST_Area(geom::geography) call (specs/db/schema.sql's
 * comment on geo.building_footprint.area_sqm), for one consistent
 * methodology across both footprint sources rather than trusting two
 * different upstream area calculations.
 */
export function mapOpenBuildingsRow(row: Record<string, string>): FootprintRow {
  const wkt = row.geometry;
  if (!wkt) {
    throw new Error("Open Buildings row is missing the geometry column");
  }
  const confidenceRaw = Number(row.confidence);
  return {
    geometry: parseWktPolygon(wkt),
    confidence: Number.isFinite(confidenceRaw) ? normalizeConfidence(confidenceRaw) : null,
    source: OPEN_BUILDINGS_SOURCE,
    sourceLicense: OPEN_BUILDINGS_LICENSE,
    sourceVintage: OPEN_BUILDINGS_VINTAGE,
  };
}
