import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, withServiceSession } from "@sodeja/db";
import { createLogger } from "@sodeja/observability";
import { computePopulationGrid } from "./computePopulationGrid.js";

/**
 * Integration tests against a real Postgres+PostGIS, same
 * skip-if-no-DATABASE_URL pattern as computeDataCoverage.test.ts. Proves the
 * areal-interpolation contract end to end: a fixture admin area WITH a real
 * census figure apportions a real, positive population across its cells and
 * counts real intersecting POIs; a fixture area with NO census row
 * (population_grid still gets generated, per B-9's scope — it is not gated
 * on census presence the way confidence tiering is) apportions an honest
 * `population_est = 0` rather than a fabricated figure.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const TEST_SOURCE = "test-fixture-b9-popgrid";
const logger = createLogger("computePopulationGrid.test");

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

const DN_CENTER: [number, number] = [-69.82, 18.42];
const DN_HALF_SIDE = 0.0025; // ~550m side
const SANTIAGO_CENTER: [number, number] = [-69.67, 18.57];
const SANTIAGO_HALF_SIDE = 0.0025;
const DN_POPULATION = 800_000;
const DN_POI_COUNT = 15;

function bboxParams(center: [number, number], halfSide: number): [number, number, number, number] {
  return [center[0] - halfSide, center[1] - halfSide, center[0] + halfSide, center[1] + halfSide];
}

describe.skipIf(!hasDb)("computePopulationGrid (integration)", () => {
  beforeAll(async () => {
    await withServiceSession(async (client) => {
      await client.query(
        `INSERT INTO geo.admin_area (level, code, name, geom, source, source_license, source_vintage)
         VALUES ('provincia', 'TEST-DN-POP', 'Distrito Nacional',
                 ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), $2, 'CC0', '2026-01-01')`,
        [JSON.stringify({ type: "Polygon", coordinates: square(...DN_CENTER, DN_HALF_SIDE) }), TEST_SOURCE],
      );
      await client.query(
        `INSERT INTO geo.admin_area (level, code, name, geom, source, source_license, source_vintage)
         VALUES ('provincia', 'TEST-SANTIAGO-POP', 'Santiago',
                 ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), $2, 'CC0', '2026-01-01')`,
        [JSON.stringify({ type: "Polygon", coordinates: square(...SANTIAGO_CENTER, SANTIAGO_HALF_SIDE) }), TEST_SOURCE],
      );

      const dnId = await client.query<{ id: string }>("SELECT id FROM geo.admin_area WHERE code = 'TEST-DN-POP'");
      await client.query(
        `INSERT INTO geo.census_population (admin_area_id, population, census_year, source, source_vintage)
         VALUES ($1, $2, 2022, $3, '2022-01-01')`,
        [dnId.rows[0]!.id, DN_POPULATION, TEST_SOURCE],
      );

      // POIs in both fixtures (population presence is not required for
      // poi_count — it's a plain intersects count).
      for (let i = 0; i < DN_POI_COUNT; i++) {
        const px = DN_CENTER[0] - DN_HALF_SIDE + (2 * DN_HALF_SIDE * i) / (DN_POI_COUNT - 1);
        await client.query(
          `INSERT INTO geo.poi_place (external_id, geom, source, source_license, source_vintage)
           VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, 'CC0', '2026-01-01')`,
          [`${TEST_SOURCE}-dn-${i}`, px, DN_CENTER[1], TEST_SOURCE],
        );
      }
      await client.query(
        `INSERT INTO geo.poi_place (external_id, geom, source, source_license, source_vintage)
         VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, 'CC0', '2026-01-01')`,
        [`${TEST_SOURCE}-santiago-0`, SANTIAGO_CENTER[0], SANTIAGO_CENTER[1], TEST_SOURCE],
      );
    });
  });

  afterAll(async () => {
    await withServiceSession(async (client) => {
      // This job exclusively owns geo.population_grid — safe to clear fully.
      await client.query("DELETE FROM geo.population_grid");
      await client.query("DELETE FROM geo.poi_place WHERE source = $1", [TEST_SOURCE]);
      await client.query("DELETE FROM geo.census_population WHERE source = $1", [TEST_SOURCE]);
      await client.query("DELETE FROM geo.admin_area WHERE source = $1", [TEST_SOURCE]);
    });
    await closePool();
  });

  it("apportions a real, positive population across Distrito Nacional's cells, summing to a plausible share of the census total", async () => {
    await withServiceSession((client) => computePopulationGrid(client, logger));

    const [minLon, minLat, maxLon, maxLat] = bboxParams(DN_CENTER, DN_HALF_SIDE);
    const { rows } = await withServiceSession((client) =>
      client.query<{ population_est: number; poi_count: number }>(
        `SELECT population_est, poi_count FROM geo.population_grid
          WHERE ST_Intersects(cell, ST_MakeEnvelope($1, $2, $3, $4, 4326))`,
        [minLon, minLat, maxLon, maxLat],
      ),
    );

    expect(rows.length).toBeGreaterThan(0);
    const totalPopulation = rows.reduce((sum, r) => sum + r.population_est, 0);
    const totalPoiCount = rows.reduce((sum, r) => sum + r.poi_count, 0);
    // Cells generated near (but outside) the fixture polygon legitimately
    // get population_est=0 (their centroid falls outside the admin area, per
    // lib/grid.ts's "not clipped, ST_Intersects only" tradeoff — verified
    // directly against this exact fixture shape during development) — so the
    // assertion is on cells actually resolving population, not every cell
    // touching the bbox.
    const cellsWithPopulation = rows.filter((r) => r.population_est > 0);
    expect(cellsWithPopulation.length).toBeGreaterThan(0);
    // Cells are not clipped to the admin polygon, so the apportioned sum is
    // a plausible share of the real census figure, not required to equal it
    // exactly — but it must be within the right order of magnitude.
    expect(totalPopulation).toBeGreaterThan(DN_POPULATION * 0.1);
    expect(totalPopulation).toBeLessThan(DN_POPULATION * 3);
    // poi_count is an exact ST_Intersects count with no clipping ambiguity —
    // every POI lands in exactly one non-overlapping grid cell.
    expect(totalPoiCount).toBe(DN_POI_COUNT);
  });

  it("apportions an honest population_est = 0 for a fixture with no census row (never fabricated)", async () => {
    const [minLon, minLat, maxLon, maxLat] = bboxParams(SANTIAGO_CENTER, SANTIAGO_HALF_SIDE);
    const { rows } = await withServiceSession((client) =>
      client.query<{ population_est: number; poi_count: number }>(
        `SELECT population_est, poi_count FROM geo.population_grid
          WHERE ST_Intersects(cell, ST_MakeEnvelope($1, $2, $3, $4, 4326))`,
        [minLon, minLat, maxLon, maxLat],
      ),
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.population_est).toBe(0);
    }
    const totalPoiCount = rows.reduce((sum, r) => sum + r.poi_count, 0);
    expect(totalPoiCount).toBe(1); // the one Santiago-fixture POI, still counted independent of census absence
  });

  it("is idempotent: re-running produces the same cell count, not accumulation", async () => {
    const first = await withServiceSession((client) =>
      client.query<{ n: string }>("SELECT count(*)::int AS n FROM geo.population_grid"),
    );
    await withServiceSession((client) => computePopulationGrid(client, logger));
    const second = await withServiceSession((client) =>
      client.query<{ n: string }>("SELECT count(*)::int AS n FROM geo.population_grid"),
    );
    expect(second.rows[0]!.n).toBe(first.rows[0]!.n);
  });
});

if (!hasDb) {
  it.skip("skipped: DATABASE_URL is not set (requires local Postgres+PostGIS — see @sodeja/db README)", () => {});
}
