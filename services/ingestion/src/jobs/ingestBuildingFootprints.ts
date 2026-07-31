import type { Logger } from "@sodeja/observability";
import type { PoolClient } from "pg";
import { withServiceSession } from "@sodeja/db";
import { type BatchColumn, insertBatches } from "../lib/batchInsert.js";
import { withSwapTransaction, withTempTable } from "../lib/tempTable.js";
import type { FootprintRow } from "../transform/footprintRow.js";
import { fetchMsGlobalMlFootprints } from "../sources/msGlobalMl.js";
import { fetchOpenBuildingsFootprints, isOpenBuildingsConfigured } from "../sources/openBuildings.js";

const STAGING_TABLE = "staging_building_footprint";

const STAGING_COLUMNS: readonly BatchColumn<FootprintRow>[] = [
  {
    name: "geom",
    expr: (i) => `ST_SetSRID(ST_GeomFromGeoJSON($${i}), 4326)`,
    value: (r) => JSON.stringify(r.geometry),
  },
  { name: "confidence", expr: (i) => `$${i}`, value: (r) => r.confidence },
  { name: "source", expr: (i) => `$${i}`, value: (r) => r.source },
  { name: "source_license", expr: (i) => `$${i}`, value: (r) => r.sourceLicense },
  { name: "source_vintage", expr: (i) => `$${i}::date`, value: (r) => r.sourceVintage },
];

/** Drains an async iterable into fixed-size arrays and stages each chunk. */
async function stageFootprintStream(
  client: PoolClient,
  tableName: string,
  rows: AsyncIterable<FootprintRow>,
  batchSize = 500,
): Promise<number> {
  let buffer: FootprintRow[] = [];
  let total = 0;
  for await (const row of rows) {
    buffer.push(row);
    if (buffer.length >= batchSize) {
      total += await insertBatches(client, tableName, STAGING_COLUMNS, buffer, batchSize);
      buffer = [];
    }
  }
  if (buffer.length > 0) {
    total += await insertBatches(client, tableName, STAGING_COLUMNS, buffer, batchSize);
  }
  return total;
}

/**
 * Stages footprint rows from one or more sources, then swaps them into
 * geo.building_footprint atomically. `area_sqm` is computed here via
 * ST_Area(geom::geography) — the schema comment on
 * geo.building_footprint.area_sqm explicitly calls for the job to compute
 * it this way rather than a GENERATED column. `admin_area_id` is resolved by
 * a centroid-in-polygon spatial join against whatever geo.admin_area rows
 * exist at ingestion time (ORDER BY area ASC picks the most specific
 * containing level — e.g. municipio over provincia — when several nested
 * admin polygons all contain the point); it is left NULL if nothing
 * contains the centroid, which is an accepted outcome, not an error.
 *
 * Only the sources actually present in `rowsBySource` are deleted-and-
 * replaced — running this job with only MS GlobalML staged does not touch
 * previously-loaded Open Buildings rows from an earlier run.
 */
export async function ingestBuildingFootprints(
  client: PoolClient,
  rowsBySource: readonly AsyncIterable<FootprintRow>[],
  logger: Logger,
): Promise<{ staged: number; upserted: number }> {
  return withTempTable(
    client,
    STAGING_TABLE,
    `geom geometry(Polygon, 4326) NOT NULL,
     confidence numeric(4,3),
     source text NOT NULL,
     source_license text NOT NULL,
     source_vintage date NOT NULL`,
    async (tableName) => {
      let staged = 0;
      for (const rows of rowsBySource) {
        staged += await stageFootprintStream(client, tableName, rows);
      }
      logger.info({ staged }, "staged building-footprint rows");

      const upserted = await withSwapTransaction(client, async () => {
        await client.query(
          `DELETE FROM geo.building_footprint WHERE source IN (SELECT DISTINCT source FROM ${tableName})`,
        );

        const insertResult = await client.query(
          `INSERT INTO geo.building_footprint
             (geom, area_sqm, confidence, source, source_license, source_vintage, admin_area_id)
           SELECT
             s.geom,
             ST_Area(s.geom::geography),
             s.confidence,
             s.source,
             s.source_license,
             s.source_vintage,
             matched.id
           FROM ${tableName} s
           LEFT JOIN LATERAL (
             SELECT a.id
             FROM geo.admin_area a
             WHERE ST_Contains(a.geom, ST_Centroid(s.geom))
             ORDER BY ST_Area(a.geom) ASC
             LIMIT 1
           ) matched ON true`,
        );
        return insertResult.rowCount ?? 0;
      });

      logger.info({ upserted }, "swapped building-footprint rows into geo.building_footprint");
      return { staged, upserted };
    },
  );
}

export async function runIngestBuildingFootprintsJob(logger: Logger): Promise<void> {
  const sources: AsyncIterable<FootprintRow>[] = [fetchMsGlobalMlFootprints(logger)];

  if (isOpenBuildingsConfigured()) {
    sources.push(fetchOpenBuildingsFootprints(logger));
  } else {
    logger.warn(
      "OPEN_BUILDINGS_SOURCE_URLS is not set; skipping the Open Buildings cross-check/gap-fill source " +
        "(MS GlobalML remains the primary source and is not affected). See README.md.",
    );
  }

  await withServiceSession((client) => ingestBuildingFootprints(client, sources, logger));
}
