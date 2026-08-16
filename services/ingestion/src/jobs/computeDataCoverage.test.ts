import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, withServiceSession } from "@sodeja/db";
import { createLogger } from "@sodeja/observability";
import { computeDataCoverage } from "./computeDataCoverage.js";

/**
 * Integration tests against a real Postgres+PostGIS, same
 * skip-if-no-DATABASE_URL pattern as apps/api/src/geo/geo.controller.test.ts
 * and every other DB-backed test in this monorepo. Exercises the job's core
 * claim end to end: a well-covered fixture area scores 'alta' and a fixture
 * area with zero footprints/POIs/census (the "freshly-provisioned database"
 * scenario B-9's scope doc calls out explicitly) scores 'insuficiente' —
 * risk D3's mechanism working as designed, not a bug to route around.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const TEST_SOURCE = "test-fixture-b9-coverage";
const logger = createLogger("computeDataCoverage.test");

function square(centerLon: number, centerLat: number, halfSideDeg: number): number[][][] {
  const [x, y] = [centerLon, centerLat];
  return [
    [
      [x - halfSideDeg, y - halfSideDeg],
      [x + halfSideDeg, y - halfSideDeg],
      [x + halfSideDeg, y + halfSideDeg],
      [x - halfSideDeg, y + halfSideDeg],
      [x - halfSideDeg, y - halfSideDeg],
    ],
  ];
}

// Two small (~550m-side) fixture provinces, well apart, both using real
// LAUNCH_AREA_PROVINCES names (the job's province filter matches by name).
// "Distrito Nacional" gets dense footprint/POI/census fixtures; "Santiago"
// gets NOTHING else — the sparse/empty-tables case.
const DN_CENTER: [number, number] = [-69.85, 18.45];
const DN_HALF_SIDE = 0.0025; // ~550m side at this latitude
const SANTIAGO_CENTER: [number, number] = [-69.7, 18.6];
const SANTIAGO_HALF_SIDE = 0.0025;

describe.skipIf(!hasDb)("computeDataCoverage (integration)", () => {
  beforeAll(async () => {
    await withServiceSession(async (client) => {
      await client.query(
        `INSERT INTO geo.admin_area (level, code, name, geom, source, source_license, source_vintage)
         VALUES ('provincia', 'TEST-DN-COV', 'Distrito Nacional',
                 ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), $2, 'CC0', '2026-01-01')`,
        [JSON.stringify({ type: "Polygon", coordinates: square(...DN_CENTER, DN_HALF_SIDE) }), TEST_SOURCE],
      );
      await client.query(
        `INSERT INTO geo.admin_area (level, code, name, geom, source, source_license, source_vintage)
         VALUES ('provincia', 'TEST-SANTIAGO-COV', 'Santiago',
                 ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), $2, 'CC0', '2026-01-01')`,
        [JSON.stringify({ type: "Polygon", coordinates: square(...SANTIAGO_CENTER, SANTIAGO_HALF_SIDE) }), TEST_SOURCE],
      );

      // Census presence for Distrito Nacional only.
      const dnId = await client.query<{ id: string }>(
        "SELECT id FROM geo.admin_area WHERE code = 'TEST-DN-COV'",
      );
      await client.query(
        `INSERT INTO geo.census_population (admin_area_id, population, census_year, source, source_vintage)
         VALUES ($1, 50000, 2022, $2, '2022-01-01')`,
        [dnId.rows[0]!.id, TEST_SOURCE],
      );

      // Saturate Distrito Nacional with footprints and high-confidence POIs
      // well beyond the scoring references (FOOTPRINT_REFERENCE_COUNT=30,
      // POI_REFERENCE_WEIGHT=10) — a dense 30x30 (900-point) grid inside the
      // ~550m fixture (roughly 3,000 points/km^2), so every generated 250m
      // cell touching it comfortably exceeds both references regardless of
      // exact grid alignment. Bulk-inserted via `unnest` (two round trips,
      // not 900) for test speed.
      const steps = 30;
      const lons: number[] = [];
      const lats: number[] = [];
      for (let i = 0; i < steps; i++) {
        for (let j = 0; j < steps; j++) {
          lons.push(DN_CENTER[0] - DN_HALF_SIDE + (2 * DN_HALF_SIDE * i) / (steps - 1));
          lats.push(DN_CENTER[1] - DN_HALF_SIDE + (2 * DN_HALF_SIDE * j) / (steps - 1));
        }
      }
      const ids = lons.map((_, idx) => `${TEST_SOURCE}-${idx}`);

      // geo.building_footprint.source has a CHECK constraint restricting it
      // to the four real dataset values (specs/db/schema.sql) — 'osm' is
      // used here for the fixture rows (cleaned up by bbox below, like
      // apps/api/src/geo/geo.controller.test.ts does), not TEST_SOURCE.
      await client.query(
        `INSERT INTO geo.building_footprint (geom, area_sqm, source, source_license, source_vintage)
         SELECT ST_MakeEnvelope(lon - 0.00002, lat - 0.00002, lon + 0.00002, lat + 0.00002, 4326),
                ST_Area(ST_MakeEnvelope(lon - 0.00002, lat - 0.00002, lon + 0.00002, lat + 0.00002, 4326)::geography),
                'osm', 'ODbL', '2026-01-01'
           FROM unnest($1::float8[], $2::float8[]) AS t(lon, lat)`,
        [lons, lats],
      );
      await client.query(
        `INSERT INTO geo.poi_place (external_id, geom, confidence, source, source_license, source_vintage)
         SELECT id, ST_SetSRID(ST_MakePoint(lon, lat), 4326), 0.95, $4, 'CC0', '2026-01-01'
           FROM unnest($1::text[], $2::float8[], $3::float8[]) AS t(id, lon, lat)`,
        [ids, lons, lats, TEST_SOURCE],
      );
    });
  });

  afterAll(async () => {
    await withServiceSession(async (client) => {
      // This job exclusively owns geo.data_coverage_cell — safe to clear fully.
      await client.query("DELETE FROM geo.data_coverage_cell");
      await client.query("DELETE FROM geo.poi_place WHERE source = $1", [TEST_SOURCE]);
      await client.query(
        `DELETE FROM geo.building_footprint
          WHERE source = 'osm'
            AND (ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
              OR ST_Intersects(geom, ST_MakeEnvelope($5, $6, $7, $8, 4326)))`,
        [
          DN_CENTER[0] - DN_HALF_SIDE,
          DN_CENTER[1] - DN_HALF_SIDE,
          DN_CENTER[0] + DN_HALF_SIDE,
          DN_CENTER[1] + DN_HALF_SIDE,
          SANTIAGO_CENTER[0] - SANTIAGO_HALF_SIDE,
          SANTIAGO_CENTER[1] - SANTIAGO_HALF_SIDE,
          SANTIAGO_CENTER[0] + SANTIAGO_HALF_SIDE,
          SANTIAGO_CENTER[1] + SANTIAGO_HALF_SIDE,
        ],
      );
      await client.query("DELETE FROM geo.census_population WHERE source = $1", [TEST_SOURCE]);
      await client.query("DELETE FROM geo.admin_area WHERE source = $1", [TEST_SOURCE]);
    });
    await closePool();
  });

  it("scores every cell over the saturated Distrito Nacional fixture as 'alta'", async () => {
    await withServiceSession((client) => computeDataCoverage(client, logger));

    // Cells generated near (but outside) the fixture polygon legitimately
    // score low/zero (their centroid falls outside the admin area and the
    // saturated footprint/POI grid, per lib/grid.ts's "not clipped" tradeoff
    // — same reasoning as computePopulationGrid.test.ts's boundary cells) —
    // so this asserts on the cells that actually landed inside the
    // saturated core (footprint_score = 1, the maximum), not every cell
    // touching the loose bbox.
    const { rows } = await withServiceSession((client) =>
      client.query<{ tier: string; footprint_score: string; poi_score: string; census_score: string }>(
        `SELECT tier, footprint_score, poi_score, census_score
           FROM geo.data_coverage_cell
          WHERE ST_Intersects(cell, ST_MakeEnvelope($1, $2, $3, $4, 4326))
            AND footprint_score = 1`,
        [
          DN_CENTER[0] - DN_HALF_SIDE,
          DN_CENTER[1] - DN_HALF_SIDE,
          DN_CENTER[0] + DN_HALF_SIDE,
          DN_CENTER[1] + DN_HALF_SIDE,
        ],
      ),
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tier).toBe("alta");
      expect(Number(row.poi_score)).toBe(1);
      expect(Number(row.census_score)).toBe(1);
    }
  });

  it("scores every cell over the empty Santiago fixture as 'insuficiente' (sparse/empty tables degrade honestly)", async () => {
    await withServiceSession((client) => computeDataCoverage(client, logger));

    const { rows } = await withServiceSession((client) =>
      client.query<{ tier: string; footprint_score: string; poi_score: string; census_score: string }>(
        `SELECT tier, footprint_score, poi_score, census_score
           FROM geo.data_coverage_cell
          WHERE ST_Intersects(cell, ST_MakeEnvelope($1, $2, $3, $4, 4326))`,
        [
          SANTIAGO_CENTER[0] - SANTIAGO_HALF_SIDE,
          SANTIAGO_CENTER[1] - SANTIAGO_HALF_SIDE,
          SANTIAGO_CENTER[0] + SANTIAGO_HALF_SIDE,
          SANTIAGO_CENTER[1] + SANTIAGO_HALF_SIDE,
        ],
      ),
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tier).toBe("insuficiente");
      expect(Number(row.footprint_score)).toBe(0);
      expect(Number(row.poi_score)).toBe(0);
      expect(Number(row.census_score)).toBe(0);
    }
  });

  it("every generated cell is marked is_launch_area = true", async () => {
    const { rows } = await withServiceSession((client) =>
      client.query<{ n: string }>("SELECT count(*)::int AS n FROM geo.data_coverage_cell WHERE is_launch_area = false"),
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("is idempotent: re-running produces the same cell count, not accumulation", async () => {
    const first = await withServiceSession((client) =>
      client.query<{ n: string }>("SELECT count(*)::int AS n FROM geo.data_coverage_cell"),
    );
    await withServiceSession((client) => computeDataCoverage(client, logger));
    const second = await withServiceSession((client) =>
      client.query<{ n: string }>("SELECT count(*)::int AS n FROM geo.data_coverage_cell"),
    );
    expect(second.rows[0]!.n).toBe(first.rows[0]!.n);
  });
});

if (!hasDb) {
  it.skip("skipped: DATABASE_URL is not set (requires local Postgres+PostGIS — see @sodeja/db README)", () => {});
}
