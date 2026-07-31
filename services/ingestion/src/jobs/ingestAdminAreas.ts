import type { Logger } from "@sodeja/observability";
import type { PoolClient } from "pg";
import { withServiceSession } from "@sodeja/db";
import { type BatchColumn, insertBatches } from "../lib/batchInsert.js";
import { withSwapTransaction, withTempTable } from "../lib/tempTable.js";
import { OCHA_SOURCE, type AdminAreaRow } from "../transform/adminAreaRow.js";
import { fetchOchaAdminAreas } from "../sources/ochaAdminAreas.js";

const STAGING_TABLE = "staging_admin_area";

const STAGING_COLUMNS: readonly BatchColumn<AdminAreaRow>[] = [
  { name: "level", expr: (i) => `$${i}`, value: (r) => r.level },
  { name: "code", expr: (i) => `$${i}`, value: (r) => r.code },
  { name: "parent_code", expr: (i) => `$${i}`, value: (r) => r.parentCode },
  { name: "name", expr: (i) => `$${i}`, value: (r) => r.name },
  // ST_Multi upgrades a bare Polygon to a single-member MultiPolygon; a
  // no-op if the source geometry is already MultiPolygon. geo.admin_area.geom
  // is declared MultiPolygon (specs/db/schema.sql), and OCHA mixes both
  // geometry types across features.
  {
    name: "geom",
    expr: (i) => `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($${i}), 4326))`,
    value: (r) => JSON.stringify(r.geometry),
  },
  { name: "source", expr: (i) => `$${i}`, value: (r) => r.source },
  { name: "source_license", expr: (i) => `$${i}`, value: (r) => r.sourceLicense },
  { name: "source_vintage", expr: (i) => `$${i}::date`, value: (r) => r.sourceVintage },
];

/**
 * Stages `rows` and swaps them into geo.admin_area in one transaction.
 * Idempotent: every row in this job shares `source` = 'ocha_cod_ab' (OCHA is
 * the only admin-geometry source in scope for B-6), so re-running deletes
 * and replaces the full OCHA-sourced set rather than accumulating
 * duplicates. parent_id is resolved in a second pass, after all rows exist,
 * because geo.admin_area.parent_id is self-referencing — a child's parent
 * row may not have an id yet at insert time within the same batch.
 *
 * Takes already-fetched `rows` (rather than fetching itself) so it is
 * testable against a real Postgres without a live HDX round-trip — see
 * ingestAdminAreas.test.ts.
 */
export async function ingestAdminAreas(
  client: PoolClient,
  rows: readonly AdminAreaRow[],
  logger: Logger,
): Promise<{ staged: number; upserted: number }> {
  return withTempTable(
    client,
    STAGING_TABLE,
    `level text NOT NULL,
     code text NOT NULL,
     parent_code text,
     name text NOT NULL,
     geom geometry(MultiPolygon, 4326) NOT NULL,
     source text NOT NULL,
     source_license text NOT NULL,
     source_vintage date NOT NULL`,
    async (tableName) => {
      const staged = await insertBatches(client, tableName, STAGING_COLUMNS, rows);
      logger.info({ staged }, "staged OCHA admin-area rows");

      const upserted = await withSwapTransaction(client, async () => {
        await client.query("DELETE FROM geo.admin_area WHERE source = $1", [OCHA_SOURCE]);

        const insertResult = await client.query(
          `INSERT INTO geo.admin_area (level, code, name, geom, source, source_license, source_vintage)
           SELECT level, code, name, geom, source, source_license, source_vintage
           FROM ${tableName}`,
        );

        // Joined on code alone (not level): OCHA pcodes are hierarchically
        // prefixed and strictly increase in length per level (pais "DO",
        // provincia 6 chars, municipio 8, seccion 10), so a code collision
        // across levels does not occur in practice for this dataset.
        await client.query(
          `UPDATE geo.admin_area child
           SET parent_id = parent.id
           FROM ${tableName} staged
           JOIN geo.admin_area parent ON parent.code = staged.parent_code
           WHERE child.code = staged.code
             AND child.level = staged.level
             AND staged.parent_code IS NOT NULL`,
        );

        return insertResult.rowCount ?? 0;
      });

      logger.info({ upserted }, "swapped OCHA admin-area rows into geo.admin_area");
      return { staged, upserted };
    },
  );
}

export async function runIngestAdminAreasJob(logger: Logger): Promise<void> {
  const rows = await fetchOchaAdminAreas(logger);
  await withServiceSession((client) => ingestAdminAreas(client, rows, logger));
}
