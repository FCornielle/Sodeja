import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, withServiceSession } from "@sodeja/db";
import { createLogger } from "@sodeja/observability";
import { ingestCensusPopulation } from "./ingestCensusPopulation.js";
import { ingestAdminAreas } from "./ingestAdminAreas.js";
import { OCHA_SOURCE } from "../transform/adminAreaRow.js";
import { extractAdminAreaRows } from "../sources/ochaAdminAreas.js";
import { parseCensusCsv } from "../transform/censusRow.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");
const logger = createLogger("ingestCensusPopulation.test");

describe.runIf(hasDb)("ingestCensusPopulation (integration)", () => {
  beforeAll(async () => {
    // geo.census_population.admin_area_id is a FK, so the admin areas the
    // fixture census extract references must exist first.
    const zipBuffer = readFileSync(join(FIXTURES_DIR, "ocha-admin-boundaries-sample.zip"));
    const rows = extractAdminAreaRows(zipBuffer, "2026-01-01");
    await withServiceSession((client) => ingestAdminAreas(client, rows, logger));
  });

  afterAll(async () => {
    await withServiceSession(async (client) => {
      await client.query(
        `DELETE FROM geo.census_population WHERE admin_area_id IN
           (SELECT id FROM geo.admin_area WHERE source = $1)`,
        [OCHA_SOURCE],
      );
      await client.query("DELETE FROM geo.admin_area WHERE source = $1", [OCHA_SOURCE]);
    });
    await closePool();
  });

  it("upserts the fixture census extract, resolving admin_area_id by (level, code)", async () => {
    const content = readFileSync(join(FIXTURES_DIR, "census-extract-FIXTURE.csv"), "utf8");
    const rows = parseCensusCsv(content, "2022-01-01");

    const result = await withServiceSession((client) => ingestCensusPopulation(client, rows, logger));
    expect(result.unresolved).toEqual([]);
    expect(result.upserted).toBe(3);

    const pais = await withServiceSession((client) =>
      client.query(
        `SELECT cp.population, cp.households, cp.census_year
         FROM geo.census_population cp
         JOIN geo.admin_area a ON a.id = cp.admin_area_id
         WHERE a.level = 'pais' AND a.code = 'DO'`,
      ),
    );
    expect(pais.rows[0]!.population).toBe(10_760_028);
    expect(pais.rows[0]!.households).toBe(4_418_619);
  });

  it("is idempotent via ON CONFLICT (admin_area_id) DO UPDATE, not a duplicate row", async () => {
    const content = readFileSync(join(FIXTURES_DIR, "census-extract-FIXTURE.csv"), "utf8");
    const rows = parseCensusCsv(content, "2022-01-01");

    await withServiceSession((client) => ingestCensusPopulation(client, rows, logger));
    await withServiceSession((client) => ingestCensusPopulation(client, rows, logger));

    const count = await withServiceSession((client) =>
      client.query(
        `SELECT count(*)::int AS n FROM geo.census_population cp
         JOIN geo.admin_area a ON a.id = cp.admin_area_id
         WHERE a.source = $1`,
        [OCHA_SOURCE],
      ),
    );
    expect(count.rows[0]!.n).toBe(3);
  });

  it("fails the whole batch atomically when an admin area cannot be resolved", async () => {
    const rows = parseCensusCsv(
      "admin_level,admin_area_code,population,census_year\nmunicipio,DOES-NOT-EXIST,100,2022\n",
      "2022-01-01",
    );
    await expect(
      withServiceSession((client) => ingestCensusPopulation(client, rows, logger)),
    ).rejects.toThrow(/not found in geo.admin_area/);
  });
});

if (!hasDb) {
  it.skip("skipped: DATABASE_URL is not set (requires local Postgres+PostGIS — see @sodeja/db README)", () => {});
}
