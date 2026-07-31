import type { PoolClient } from "pg";

/**
 * Runs `fn` with a session-scoped staging table created ahead of time and
 * dropped afterward (success or failure). This is the "stage" half of the
 * "staged then swapped" contract in services/ingestion/README.md: rows are
 * fully fetched, parsed, and validated into `tableName` — outside any
 * production-table transaction — before a job ever touches `geo.*`. If
 * fetching/parsing fails partway through, the temp table is dropped and
 * `geo.*` was never opened for writing, so a partial upstream failure cannot
 * leave the map half-populated.
 *
 * A real Postgres TEMP TABLE (not a plain `geo`-schema table) is used
 * deliberately: it is only ever visible on this connection, is never
 * written by two concurrent job runs, and needs no migration of its own.
 */
export async function withTempTable<T>(
  client: PoolClient,
  tableName: string,
  createTableBody: string,
  fn: (tableName: string) => Promise<T>,
): Promise<T> {
  await client.query(`DROP TABLE IF EXISTS ${tableName}`);
  await client.query(`CREATE TEMP TABLE ${tableName} (${createTableBody})`);
  try {
    return await fn(tableName);
  } finally {
    await client.query(`DROP TABLE IF EXISTS ${tableName}`);
  }
}

/**
 * The "swap" half: runs `fn` inside a single transaction so the delete-by-
 * source and re-insert-from-staging are atomic — a crash mid-swap rolls back
 * to the pre-swap state rather than leaving `geo.*` half-updated.
 */
export async function withSwapTransaction<T>(
  client: PoolClient,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
