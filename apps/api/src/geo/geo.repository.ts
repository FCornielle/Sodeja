import type { QueryClient } from "@sodeja/rules";
import type { BuildingFootprint, CoverageResult } from "@sodeja/schemas";

/**
 * Per the Master Plan (docs/SODEJA_MASTER_PLAN.md): "Geography: Distrito
 * Nacional + Santo Domingo province + Santiago only." Reuses the exact
 * province names the B-10 seed already scoped `content.jurisdiction` to
 * (packages/db/migrations/1785510924741_seed-rules-content.sql) rather than
 * hardcoding a new bbox — `geo.admin_area` is populated independently (B-6,
 * OCHA COD-AB ingestion) but its `level='provincia'` `name` values are
 * expected to match these same three strings.
 */
export const LAUNCH_AREA_PROVINCES = ["Distrito Nacional", "Santo Domingo", "Santiago"] as const;

interface FootprintRow {
  id: string;
  geom: string; // GeoJSON text, from ST_AsGeoJSON
  area_sqm: string;
  source: string;
  source_license: string;
  source_vintage: Date;
}

function toBuildingFootprint(row: FootprintRow): BuildingFootprint {
  return {
    id: Number(row.id),
    geom: JSON.parse(row.geom) as BuildingFootprint["geom"],
    areaSqm: Number(row.area_sqm),
    source: row.source as BuildingFootprint["source"],
    sourceLicense: row.source_license,
    sourceVintage: row.source_vintage.toISOString().slice(0, 10),
  };
}

const FOOTPRINT_COLUMNS = `id, ST_AsGeoJSON(geom) AS geom, area_sqm, source, source_license, source_vintage`;

/**
 * Tap-to-select (UX spec Step 1): `ST_Contains(geom, tap_point)`, the same
 * predicate services/ingestion/src/jobs/ingestBuildingFootprints.ts uses for
 * the admin-area spatial join. Ordered by id only for deterministic test
 * assertions; overlapping footprints (the "multiple candidates" UX state)
 * are returned in full, never collapsed to one.
 */
export async function fetchFootprintsAtPoint(
  client: QueryClient,
  lon: number,
  lat: number,
): Promise<BuildingFootprint[]> {
  const { rows } = await client.query<FootprintRow>(
    `SELECT ${FOOTPRINT_COLUMNS}
       FROM geo.building_footprint
      WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
      ORDER BY id`,
    [lon, lat],
  );
  return rows.map(toBuildingFootprint);
}

/**
 * Viewport footprint layer (UX spec Step 1: "footprint layer visible at zoom
 * >= 17"). `ST_Intersects` against the requested envelope uses
 * `building_footprint_geom_gix` (the same gist index tap-to-select relies
 * on) same as any bbox-vs-geometry spatial predicate. `limit` is the
 * caller-enforced row cap (see geo.service.ts) — this function does not pick
 * its own default so the cap stays defined in exactly one place.
 */
export async function fetchFootprintsInBbox(
  client: QueryClient,
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
  limit: number,
): Promise<BuildingFootprint[]> {
  const { rows } = await client.query<FootprintRow>(
    `SELECT ${FOOTPRINT_COLUMNS}
       FROM geo.building_footprint
      WHERE ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
      ORDER BY id
      LIMIT $5`,
    [minLon, minLat, maxLon, maxLat, limit],
  );
  return rows.map(toBuildingFootprint);
}

interface AdminAreaRow {
  id: string;
  name: string;
}

/**
 * Launch-area coverage check (UX spec Step 1's "Todavia no cubrimos esta
 * zona" banner): does this point fall inside one of the three launch-area
 * `geo.admin_area` provincia polygons? Returns the containing province when
 * found; `covered: false` with nulls otherwise — never throws for an
 * uncovered point, since that is an expected, common outcome, not an error.
 */
export async function fetchCoverageAtPoint(
  client: QueryClient,
  lon: number,
  lat: number,
): Promise<CoverageResult> {
  const { rows } = await client.query<AdminAreaRow>(
    `SELECT id, name
       FROM geo.admin_area
      WHERE level = 'provincia'
        AND name = ANY($1)
        AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($2, $3), 4326))
      LIMIT 1`,
    [LAUNCH_AREA_PROVINCES, lon, lat],
  );
  const row = rows[0];
  if (!row) return { covered: false, adminAreaId: null, adminAreaName: null };
  return { covered: true, adminAreaId: Number(row.id), adminAreaName: row.name };
}
