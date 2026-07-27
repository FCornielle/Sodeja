import type { PoolClient } from "pg";
import { getPool } from "./pool.js";

/**
 * Runs `fn` inside a transaction scoped to `userId`, the local-Postgres
 * equivalent of what Supabase's PostgREST layer does with a JWT: RLS policies
 * read the current user via auth.uid() (see migrations/*_initial_schema.sql),
 * which in turn reads the `request.jwt.claim.sub` GUC set here. SET LOCAL
 * confines the role switch and the claim to this transaction only, so a
 * pooled connection can never leak one request's identity into the next.
 */
export async function withUserSession<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Escape hatch for migrations, scheduled ingestion, and other paths that must
 * run as the connecting (superuser/service) role and therefore bypass RLS.
 * Application request handlers should use withUserSession instead.
 */
export async function withServiceSession<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
