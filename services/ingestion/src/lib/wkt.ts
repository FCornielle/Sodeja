import type { PolygonGeometry } from "./geojson.js";

/**
 * Parses a WKT POLYGON string — the `geometry` column format in Google Open
 * Buildings V3's CSV export (`POLYGON((lon lat, lon lat, ...), (hole...))`)
 * — into a GeoJSON Polygon, so both footprint sources (MS GlobalML, which is
 * already GeoJSON, and Open Buildings, which is WKT) can be staged through
 * the same `ST_GeomFromGeoJSON` column expression in
 * jobs/ingestBuildingFootprints.ts rather than needing two different SQL
 * code paths.
 *
 * Only handles POLYGON (no MULTIPOLYGON, no Z/M coordinates) — the only
 * shape Open Buildings' per-building export produces.
 */
export function parseWktPolygon(wkt: string): PolygonGeometry {
  const trimmed = wkt.trim();
  const match = /^POLYGON\s*\((.*)\)$/is.exec(trimmed);
  if (!match) {
    throw new Error(`Not a WKT POLYGON: "${wkt.slice(0, 80)}"`);
  }
  const ringsSection = match[1]!;
  const rings = splitTopLevelParens(ringsSection);
  if (rings.length === 0) {
    throw new Error(`WKT POLYGON has no rings: "${wkt.slice(0, 80)}"`);
  }
  const coordinates = rings.map(parseRing);
  return { type: "Polygon", coordinates };
}

/** Splits "(a, b),(c, d)" into ["a, b", "c, d"], respecting paren nesting. */
function splitTopLevelParens(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === "(") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth === 0 && start >= 0) {
        parts.push(input.slice(start, i));
        start = -1;
      }
    }
  }
  return parts;
}

function parseRing(ring: string): number[][] {
  return ring
    .split(",")
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const parts = pair.split(/\s+/).map(Number);
      const [lon, lat] = parts;
      if (parts.length < 2 || lon === undefined || lat === undefined || Number.isNaN(lon) || Number.isNaN(lat)) {
        throw new Error(`Invalid WKT coordinate pair: "${pair}"`);
      }
      return [lon, lat];
    });
}
