import { readFile } from "node:fs/promises";
import type { Logger } from "@sodeja/observability";
import type { PoolClient } from "pg";
import { withServiceSession } from "@sodeja/db";
import { requireEnv } from "../lib/env.js";
import { type CensusExtractRow, parseCensusCsv } from "../transform/censusRow.js";

/**
 * Upserts a batch of already-parsed census rows into geo.census_population.
 * Each row is resolved to an admin_area_id by (level, code) and, if no
 * matching geo.admin_area row exists yet, the whole batch fails atomically
 * (BEGIN/ROLLBACK) rather than upserting some rows and silently dropping
 * others — a partial census load is worse than none, since Module 1's
 * coverage scoring (geo.data_coverage_cell, B-9) would read the gap as "zero
 * population" rather than "not loaded yet".
 *
 * Idempotent via `ON CONFLICT (admin_area_id) DO UPDATE`: the table's
 * primary key already is admin_area_id (specs/db/schema.sql), so re-running
 * the same extract is a no-op swap rather than a duplicate insert.
 */
export async function ingestCensusPopulation(
  client: PoolClient,
  rows: readonly CensusExtractRow[],
  logger: Logger,
): Promise<{ upserted: number; unresolved: string[] }> {
  await client.query("BEGIN");
  try {
    const unresolved: string[] = [];
    let upserted = 0;

    for (const row of rows) {
      const areaResult = await client.query<{ id: string }>(
        "SELECT id FROM geo.admin_area WHERE level = $1 AND code = $2",
        [row.adminLevel, row.adminAreaCode],
      );
      const adminAreaId = areaResult.rows[0]?.id;
      if (!adminAreaId) {
        unresolved.push(`${row.adminLevel}:${row.adminAreaCode}`);
        continue;
      }

      await client.query(
        `INSERT INTO geo.census_population
           (admin_area_id, population, households, census_year, source, source_vintage)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (admin_area_id) DO UPDATE SET
           population = EXCLUDED.population,
           households = EXCLUDED.households,
           census_year = EXCLUDED.census_year,
           source = EXCLUDED.source,
           source_vintage = EXCLUDED.source_vintage`,
        [adminAreaId, row.population, row.households, row.censusYear, row.source, row.sourceVintage],
      );
      upserted++;
    }

    if (unresolved.length > 0) {
      throw new Error(
        `Census extract references admin areas not found in geo.admin_area: ${unresolved.join(", ")}. ` +
          "Run the admin-area ingestion job (B-6 OCHA COD-AB) first.",
      );
    }

    await client.query("COMMIT");
    logger.info({ upserted }, "upserted census_population rows");
    return { upserted, unresolved };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

const DEFAULT_VINTAGE = "2022-01-01"; // ONE Censo 2022 reference date

export async function runIngestCensusPopulationJob(logger: Logger): Promise<void> {
  const csvPath = requireEnv(
    "CENSUS_EXTRACT_CSV_PATH",
    "Point it at a structured CSV extracted from ONE's REDATAM tool " +
      "(REDATAM has no API — see README.md 'Census data' section for the manual extraction steps).",
  );
  const content = await readFile(csvPath, "utf8");
  const rows = parseCensusCsv(content, DEFAULT_VINTAGE);
  logger.info({ csvPath, rows: rows.length }, "parsed census extract");

  await withServiceSession((client) => ingestCensusPopulation(client, rows, logger));
}
