import type { Logger } from "@sodeja/observability";
import type { PoolClient } from "pg";
import { withServiceSession } from "@sodeja/db";
import { type BatchColumn, insertBatches } from "../lib/batchInsert.js";
import { withSwapTransaction, withTempTable } from "../lib/tempTable.js";
import { OVERTURE_SOURCE, type PoiPlaceRow } from "../transform/poiPlaceRow.js";
import { fetchOverturePlaces } from "../sources/overturePlaces.js";

const STAGING_TABLE = "staging_poi_place";

const STAGING_COLUMNS: readonly BatchColumn<PoiPlaceRow>[] = [
  { name: "external_id", expr: (i) => `$${i}`, value: (r) => r.externalId },
  { name: "name", expr: (i) => `$${i}`, value: (r) => r.name },
  { name: "category", expr: (i) => `$${i}`, value: (r) => r.category },
  { name: "raw_category", expr: (i) => `$${i}`, value: (r) => r.rawCategory },
  { name: "confidence", expr: (i) => `$${i}`, value: (r) => r.confidence },
  {
    name: "geom",
    expr: (i) => `ST_SetSRID(ST_GeomFromGeoJSON($${i}), 4326)`,
    value: (r) => JSON.stringify(r.geometry),
  },
  { name: "source", expr: (i) => `$${i}`, value: (r) => r.source },
  { name: "source_license", expr: (i) => `$${i}`, value: (r) => r.sourceLicense },
  { name: "source_vintage", expr: (i) => `$${i}::date`, value: (r) => r.sourceVintage },
];

/** Drains an async iterable into fixed-size arrays and stages each chunk (mirrors ingestBuildingFootprints.ts). */
async function stagePoiStream(
  client: PoolClient,
  tableName: string,
  rows: AsyncIterable<PoiPlaceRow>,
  batchSize = 500,
): Promise<number> {
  let buffer: PoiPlaceRow[] = [];
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
 * Stages Overture Places rows and swaps them into geo.poi_place atomically.
 * `confidence`, `category` (mapped) and `raw_category` (original) are all
 * staged and written as-is — never filtered or dropped here — per the P0-1
 * spike's explicit recommendation that confidence-tier and category
 * filtering are downstream, query-time concerns (B-9 coverage-tier
 * suppression, M1/M8 competitor counting), not something this ingestion job
 * bakes in as a silent exclusion.
 *
 * `admin_area_id` is resolved the same way ingestBuildingFootprints.ts
 * resolves it for footprints: a point-in-polygon spatial join against
 * whatever geo.admin_area rows exist at ingestion time, picking the
 * smallest-area (most specific) containing polygon, NULL if none contains
 * the point. This is enrichment only — it does NOT determine which rows are
 * inserted (the bbox query already scoped that); geo.admin_area may well be
 * empty or only partially loaded when this job runs.
 *
 * Idempotent: every row shares source = 'overture' (the only POI source in
 * scope for B-5), so re-running deletes and replaces the full Overture set
 * rather than accumulating duplicates — same delete-by-source, insert-from-
 * staging contract as B-4/B-6.
 */
export async function ingestPoiPlaces(
  client: PoolClient,
  rows: AsyncIterable<PoiPlaceRow>,
  logger: Logger,
): Promise<{ staged: number; upserted: number }> {
  return withTempTable(
    client,
    STAGING_TABLE,
    `external_id    text NOT NULL,
     name           text,
     category       text,
     raw_category   text,
     confidence     numeric(4,3),
     geom           geometry(Point, 4326) NOT NULL,
     source         text NOT NULL,
     source_license text NOT NULL,
     source_vintage date NOT NULL`,
    async (tableName) => {
      const staged = await stagePoiStream(client, tableName, rows);
      logger.info({ staged }, "staged Overture Places rows");

      const upserted = await withSwapTransaction(client, async () => {
        await client.query("DELETE FROM geo.poi_place WHERE source = $1", [OVERTURE_SOURCE]);

        const insertResult = await client.query(
          `INSERT INTO geo.poi_place
             (external_id, name, category, raw_category, confidence, geom,
              admin_area_id, source, source_license, source_vintage)
           SELECT
             s.external_id, s.name, s.category, s.raw_category, s.confidence, s.geom,
             matched.id, s.source, s.source_license, s.source_vintage
           FROM ${tableName} s
           LEFT JOIN LATERAL (
             SELECT a.id
             FROM geo.admin_area a
             WHERE ST_Contains(a.geom, s.geom)
             ORDER BY ST_Area(a.geom) ASC
             LIMIT 1
           ) matched ON true
           -- geo.poi_place has UNIQUE(source, external_id); the preceding
           -- DELETE already clears every prior 'overture' row, so the only
           -- way this can conflict is a duplicate GERS id appearing twice
           -- within the same source extraction. DO NOTHING (keep the first
           -- occurrence, skip the duplicate) rather than aborting the whole
           -- swap over one duplicate id.
           ON CONFLICT (source, external_id) DO NOTHING`,
        );
        return insertResult.rowCount ?? 0;
      });

      logger.info({ upserted }, "swapped Overture Places rows into geo.poi_place");
      return { staged, upserted };
    },
  );
}

export async function runIngestPoiPlacesJob(logger: Logger): Promise<void> {
  await withServiceSession((client) => ingestPoiPlaces(client, fetchOverturePlaces(logger), logger));
}
