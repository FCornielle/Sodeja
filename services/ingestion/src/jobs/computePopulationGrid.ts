import type { Logger } from "@sodeja/observability";
import type { PoolClient } from "pg";
import { withServiceSession } from "@sodeja/db";
import { type BatchColumn, insertBatches } from "../lib/batchInsert.js";
import { countLaunchAreaProvinces, GRID_CELL_SIZE_M, LAUNCH_AREA_PROVINCES, launchAreaGridCte } from "../lib/grid.js";
import { withSwapTransaction, withTempTable } from "../lib/tempTable.js";
import { apportionPopulation } from "../transform/populationApportionment.js";

const STAGING_TABLE = "staging_population_grid";

interface StagingRow {
  cellGeoJson: string;
  populationEst: number;
  poiCount: number;
}

const STAGING_COLUMNS: readonly BatchColumn<StagingRow>[] = [
  {
    name: "cell",
    expr: (i) => `ST_SetSRID(ST_GeomFromGeoJSON($${i}), 4326)`,
    value: (r) => r.cellGeoJson,
  },
  { name: "population_est", expr: (i) => `$${i}`, value: (r) => r.populationEst },
  { name: "poi_count", expr: (i) => `$${i}`, value: (r) => r.poiCount },
];

/**
 * Per-cell raw inputs for areal interpolation: `cell_area_sqm` (via
 * `ST_Area(::geography)`, the same metric-area pattern
 * `ingestBuildingFootprints.ts` uses), `poi_count` (a direct
 * `ST_Intersects` count against `geo.poi_place`, no category filter — B-9's
 * `market-study` API does its OWN category-filtered competitor count at
 * query time; this column is a general density signal, not a competitor
 * count), and the census admin area actually backing the cell: the most
 * SPECIFIC (`ORDER BY ST_Area ASC`) `geo.admin_area` INTERSECTING the cell
 * that has a `geo.census_population` row — `ST_Intersects` against the cell
 * geometry, not centroid-containment (a cell can straddle an admin-area
 * boundary and still be genuinely backed by that area's census figure; see
 * `computeDataCoverage.ts`'s doc comment for the boundary-cell false negative
 * this exact centroid-containment pattern produced there) — identical
 * resolution rule to `computeDataCoverage.ts`'s census_score, and to what
 * `apps/api/src/market-study/market-study.repository.ts`'s
 * `fetchCensusYearForPoint` resolves at query time, so the census figure
 * that actually produced `population_est` is always the same one the API
 * reports back as `census_year`.
 */
const RAW_INPUTS_SQL = (cte: string) => `
  WITH ${cte}
  SELECT
    gc.cell_id,
    ST_AsGeoJSON(gc.cell) AS cell_geojson,
    ST_Area(gc.cell::geography) AS cell_area_sqm,
    COALESCE(poi.poi_count, 0) AS poi_count,
    census.population AS admin_population,
    census.admin_area_sqm AS admin_area_sqm
  FROM grid_cells gc
  LEFT JOIN LATERAL (
    SELECT count(*) AS poi_count
    FROM geo.poi_place p
    WHERE ST_Intersects(p.geom, gc.cell)
  ) poi ON true
  LEFT JOIN LATERAL (
    SELECT cp.population, ST_Area(a.geom::geography) AS admin_area_sqm
    FROM geo.admin_area a
    JOIN geo.census_population cp ON cp.admin_area_id = a.id
    WHERE ST_Intersects(a.geom, gc.cell)
    ORDER BY ST_Area(a.geom) ASC
    LIMIT 1
  ) census ON true
  ORDER BY gc.cell_id
`;

interface RawInputRow {
  cell_id: string;
  cell_geojson: string;
  cell_area_sqm: string;
  poi_count: string;
  admin_population: string | null;
  admin_area_sqm: string | null;
}

/**
 * Computes and swaps `geo.population_grid` for the three launch-area
 * provinces (B-9 / docs/SODEJA_MVP_BACKLOG.md Phase 0 refinement #7), via
 * the uniform-density-within-admin-area apportionment documented on
 * `populationApportionment.ts`. Same "compute in SQL + TypeScript, stage,
 * atomic swap" contract as `computeDataCoverage.ts` — see its doc comment
 * for why this differs from the external-source jobs' staging shape while
 * still following services/ingestion/README.md's idempotency contract.
 *
 * Full-table regeneration (no per-source delete: this table has no `source`
 * column and is exclusively owned by this job). Skips entirely, without
 * touching `geo.population_grid`, when none of the three launch-area
 * provinces exist yet in `geo.admin_area` — same guard as
 * `computeDataCoverage.ts`, same reasoning (a real prior grid must never be
 * wiped by a run that cannot regenerate it).
 *
 * A cell with no census backing at any admin level gets `population_est = 0`
 * (an honest zero — see `apportionPopulation`'s doc comment), never a
 * fabricated figure; `poi_count` is always a real `ST_Intersects` count,
 * `0` when nothing intersects.
 */
export async function computePopulationGrid(client: PoolClient, logger: Logger): Promise<{ staged: number; upserted: number }> {
  const provinceCount = await countLaunchAreaProvinces(client);
  if (provinceCount === 0) {
    logger.warn(
      { provinces: LAUNCH_AREA_PROVINCES },
      "none of the launch-area provinces exist in geo.admin_area yet — skipping computePopulationGrid " +
        "(run the admin-area ingestion job first). geo.population_grid was not modified.",
    );
    return { staged: 0, upserted: 0 };
  }

  return withTempTable(
    client,
    STAGING_TABLE,
    `cell           geometry(Polygon, 4326) NOT NULL,
     population_est integer NOT NULL,
     poi_count      integer NOT NULL`,
    async (tableName) => {
      const { rows } = await client.query<RawInputRow>(RAW_INPUTS_SQL(launchAreaGridCte()), [
        LAUNCH_AREA_PROVINCES,
        GRID_CELL_SIZE_M,
      ]);
      logger.info({ cells: rows.length }, "computed raw per-cell population inputs");

      const stagingRows: StagingRow[] = rows.map((r) => ({
        cellGeoJson: r.cell_geojson,
        populationEst: apportionPopulation(
          Number(r.cell_area_sqm),
          r.admin_population === null ? null : Number(r.admin_population),
          r.admin_area_sqm === null ? null : Number(r.admin_area_sqm),
        ),
        poiCount: Number(r.poi_count),
      }));

      const staged = await insertBatches(client, tableName, STAGING_COLUMNS, stagingRows);
      logger.info({ staged }, "staged population-grid cells");

      const upserted = await withSwapTransaction(client, async () => {
        await client.query("DELETE FROM geo.population_grid");
        const insertResult = await client.query(
          `INSERT INTO geo.population_grid (cell, population_est, poi_count)
           SELECT cell, population_est, poi_count
           FROM ${tableName}`,
        );
        return insertResult.rowCount ?? 0;
      });

      logger.info({ upserted }, "swapped population-grid cells into geo.population_grid");
      return { staged, upserted };
    },
  );
}

export async function runComputePopulationGridJob(logger: Logger): Promise<void> {
  await withServiceSession((client) => computePopulationGrid(client, logger));
}
