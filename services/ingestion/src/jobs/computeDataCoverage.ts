import type { Logger } from "@sodeja/observability";
import type { PoolClient } from "pg";
import { withServiceSession } from "@sodeja/db";
import { type BatchColumn, insertBatches } from "../lib/batchInsert.js";
import { countLaunchAreaProvinces, GRID_CELL_SIZE_M, LAUNCH_AREA_PROVINCES, launchAreaGridCte } from "../lib/grid.js";
import { withSwapTransaction, withTempTable } from "../lib/tempTable.js";
import { computeCoverageCell, type ConfidenceTier } from "../transform/coverageTier.js";

const STAGING_TABLE = "staging_data_coverage_cell";

interface StagingRow {
  cellGeoJson: string;
  footprintScore: number;
  poiScore: number;
  censusScore: 0 | 1;
  tier: ConfidenceTier;
}

const STAGING_COLUMNS: readonly BatchColumn<StagingRow>[] = [
  {
    name: "cell",
    expr: (i) => `ST_SetSRID(ST_GeomFromGeoJSON($${i}), 4326)`,
    value: (r) => r.cellGeoJson,
  },
  { name: "footprint_score", expr: (i) => `$${i}`, value: (r) => r.footprintScore },
  { name: "poi_score", expr: (i) => `$${i}`, value: (r) => r.poiScore },
  { name: "census_score", expr: (i) => `$${i}`, value: (r) => r.censusScore },
  { name: "tier", expr: (i) => `$${i}::content.confidence_tier`, value: (r) => r.tier },
];

/**
 * Per-cell raw signal query: for every generated launch-area grid cell,
 * counts `geo.building_footprint` rows intersecting it, sums
 * `COALESCE(confidence, 0.5)` over intersecting `geo.poi_place` rows, and
 * checks whether ANY `geo.admin_area` row intersecting the cell (at any
 * level — pais/provincia/municipio/seccion/barrio, whichever levels happen
 * to be loaded) has a `geo.census_population` row. `census_score` is
 * deliberately a presence check across every containing level, not just the
 * most specific one: the schema has no "real vs. fixture" flag to grade data
 * quality more finely (per B-9's scope doc), and a coarser province-level
 * census row backing a finer municipio-level cell is still real backing.
 *
 * Uses `ST_Intersects(a.geom, gc.cell)`, matching the footprint/POI checks
 * above it, rather than a centroid-containment test — a cell can legitimately
 * intersect an admin area without its centroid falling inside that area's
 * polygon (any cell straddling a province boundary), and centroid-containment
 * produced exactly that false negative in this job's own integration test:
 * a densely-covered cell right at the fixture province's edge scored
 * footprint_score=1 / poi_score=1 but census_score=0, composited to 'media'
 * instead of 'alta'. All three signals now agree on what "this cell" means.
 */
const RAW_SCORES_SQL = (cte: string) => `
  WITH ${cte}
  SELECT
    gc.cell_id,
    ST_AsGeoJSON(gc.cell) AS cell_geojson,
    COALESCE(fp.footprint_count, 0) AS footprint_count,
    COALESCE(poi.poi_weight, 0) AS poi_weight,
    CASE WHEN census.has_census THEN 1 ELSE 0 END AS census_score
  FROM grid_cells gc
  LEFT JOIN LATERAL (
    SELECT count(*) AS footprint_count
    FROM geo.building_footprint bf
    WHERE ST_Intersects(bf.geom, gc.cell)
  ) fp ON true
  LEFT JOIN LATERAL (
    SELECT sum(COALESCE(p.confidence, 0.5)) AS poi_weight
    FROM geo.poi_place p
    WHERE ST_Intersects(p.geom, gc.cell)
  ) poi ON true
  LEFT JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1
      FROM geo.admin_area a
      JOIN geo.census_population cp ON cp.admin_area_id = a.id
      WHERE ST_Intersects(a.geom, gc.cell)
    ) AS has_census
  ) census ON true
  ORDER BY gc.cell_id
`;

interface RawScoreRow {
  cell_id: string;
  cell_geojson: string;
  footprint_count: string;
  poi_weight: string;
  census_score: number;
}

/**
 * Computes and swaps `geo.data_coverage_cell` for the three launch-area
 * provinces (B-9 / docs/SODEJA_MVP_BACKLOG.md Phase 0 refinement #7). Unlike
 * the source-fed jobs in this package (footprints, POI), this job's rows
 * come entirely from SQL run against tables already in this database, not
 * from an external fetch — so "staging" here means "compute in SQL, score in
 * TypeScript, land in a TEMP TABLE" rather than "stream-parse an external
 * feed", but the idempotent stage-then-swap contract (services/ingestion/
 * README.md) is identical: nothing in `geo.data_coverage_cell` is touched
 * until the full cell set is staged.
 *
 * The ENTIRE table is regenerated on every run (a plain `DELETE FROM
 * geo.data_coverage_cell`, not a delete-by-source) — this table has no
 * `source` column and is exclusively owned by this job, so "this job's rows"
 * and "every row in the table" are the same set.
 *
 * Returns `{ cells: 0 }` without touching `geo.data_coverage_cell` at all
 * when NONE of the three launch-area provinces exist yet in `geo.admin_area`
 * — running the admin-area job (B-6) first is a genuine prerequisite, and a
 * previously-computed (real) grid must never be wiped by a run that can't
 * regenerate it.
 */
export async function computeDataCoverage(client: PoolClient, logger: Logger): Promise<{ staged: number; upserted: number }> {
  const provinceCount = await countLaunchAreaProvinces(client);
  if (provinceCount === 0) {
    logger.warn(
      { provinces: LAUNCH_AREA_PROVINCES },
      "none of the launch-area provinces exist in geo.admin_area yet — skipping computeDataCoverage " +
        "(run the admin-area ingestion job first). geo.data_coverage_cell was not modified.",
    );
    return { staged: 0, upserted: 0 };
  }

  return withTempTable(
    client,
    STAGING_TABLE,
    `cell            geometry(Polygon, 4326) NOT NULL,
     footprint_score numeric(4,3) NOT NULL,
     poi_score       numeric(4,3) NOT NULL,
     census_score    numeric(4,3) NOT NULL,
     tier            content.confidence_tier NOT NULL`,
    async (tableName) => {
      const { rows } = await client.query<RawScoreRow>(RAW_SCORES_SQL(launchAreaGridCte()), [
        LAUNCH_AREA_PROVINCES,
        GRID_CELL_SIZE_M,
      ]);
      logger.info({ cells: rows.length }, "computed raw per-cell coverage signals");

      const stagingRows: StagingRow[] = rows.map((r) => {
        const scored = computeCoverageCell(Number(r.footprint_count), Number(r.poi_weight), r.census_score as 0 | 1);
        return {
          cellGeoJson: r.cell_geojson,
          footprintScore: scored.footprintScore,
          poiScore: scored.poiScore,
          censusScore: scored.censusScore,
          tier: scored.tier,
        };
      });

      const staged = await insertBatches(client, tableName, STAGING_COLUMNS, stagingRows);
      logger.info({ staged }, "staged data-coverage cells");

      const upserted = await withSwapTransaction(client, async () => {
        await client.query("DELETE FROM geo.data_coverage_cell");
        const insertResult = await client.query(
          `INSERT INTO geo.data_coverage_cell (cell, footprint_score, poi_score, census_score, tier, is_launch_area)
           SELECT cell, footprint_score, poi_score, census_score, tier, true
           FROM ${tableName}`,
        );
        return insertResult.rowCount ?? 0;
      });

      logger.info({ upserted }, "swapped data-coverage cells into geo.data_coverage_cell");
      return { staged, upserted };
    },
  );
}

export async function runComputeDataCoverageJob(logger: Logger): Promise<void> {
  await withServiceSession((client) => computeDataCoverage(client, logger));
}
