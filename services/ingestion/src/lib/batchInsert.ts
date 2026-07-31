import type { PoolClient } from "pg";

/**
 * One column of a batched INSERT. `expr` lets a column be a raw parameter
 * (`(i) => \`$${i}\``) or wrap it in a PostGIS constructor
 * (`(i) => \`ST_SetSRID(ST_GeomFromGeoJSON($${i}), 4326)\``) — both jobs in
 * this package need geometry columns built from a parameter, not a bare
 * placeholder.
 */
export interface BatchColumn<Row> {
  name: string;
  expr: (paramIndex: number) => string;
  value: (row: Row) => unknown;
}

/**
 * Inserts `rows` into `tableName` in fixed-size batches using multi-row
 * `INSERT ... VALUES (...), (...), ...` statements. Used exclusively against
 * per-job temporary staging tables (see lib/tempTable.ts) — never against a
 * `geo.*` table directly — so a batch failing partway through never leaves
 * partial data in a production table.
 */
export async function insertBatches<Row>(
  client: PoolClient,
  tableName: string,
  columns: readonly BatchColumn<Row>[],
  rows: readonly Row[],
  batchSize = 500,
): Promise<number> {
  let inserted = 0;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const params: unknown[] = [];
    const valueGroups: string[] = [];

    for (const row of batch) {
      const placeholders = columns.map((col) => {
        params.push(col.value(row));
        return col.expr(params.length);
      });
      valueGroups.push(`(${placeholders.join(", ")})`);
    }

    const sql = `INSERT INTO ${tableName} (${columns.map((c) => c.name).join(", ")}) VALUES ${valueGroups.join(", ")}`;
    await client.query(sql, params);
    inserted += batch.length;
  }
  return inserted;
}
