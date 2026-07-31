import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closePool, withServiceSession } from "@sodeja/db";
import { createLogger } from "@sodeja/observability";
import { ingestAdminAreas } from "./ingestAdminAreas.js";
import { OCHA_SOURCE } from "../transform/adminAreaRow.js";
import { extractAdminAreaRows } from "../sources/ochaAdminAreas.js";

/**
 * Requires a live Postgres+PostGIS with the B-2 migrations applied
 * (DATABASE_URL, docker-compose up -d — see @sodeja/db's README). Skips
 * gracefully rather than failing the suite when unavailable, matching
 * @sodeja/db's schema.test.ts pattern referenced in this task's brief.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");
const logger = createLogger("ingestAdminAreas.test");

describe.runIf(hasDb)("ingestAdminAreas (integration)", () => {
  afterAll(async () => {
    await withServiceSession((client) =>
      client.query("DELETE FROM geo.admin_area WHERE source = $1", [OCHA_SOURCE]),
    );
    await closePool();
  });

  it("stages and swaps the real-shaped OCHA fixture into geo.admin_area with parent_id resolved", async () => {
    const zipBuffer = readFileSync(join(FIXTURES_DIR, "ocha-admin-boundaries-sample.zip"));
    const rows = extractAdminAreaRows(zipBuffer, "2026-01-01");

    const result = await withServiceSession((client) => ingestAdminAreas(client, rows, logger));
    expect(result.staged).toBe(rows.length);
    expect(result.upserted).toBe(rows.length);

    const dbRows = await withServiceSession((client) =>
      client.query(
        `SELECT id, level, code, parent_id FROM geo.admin_area WHERE source = $1 ORDER BY level, code`,
        [OCHA_SOURCE],
      ),
    );
    expect(dbRows.rows).toHaveLength(rows.length);

    const pais = dbRows.rows.find((r) => r.level === "pais");
    const provincia = dbRows.rows.find((r) => r.code === "DO0101");
    const municipio = dbRows.rows.find((r) => r.code === "DO010102");
    const secciones = dbRows.rows.filter((r) => r.level === "seccion");

    expect(provincia.parent_id).toBe(pais.id);
    expect(municipio.parent_id).toBe(provincia.id);
    for (const seccion of secciones) {
      expect(seccion.parent_id).toBe(municipio.id);
    }
  });

  it("is idempotent: running twice produces the same row count, not duplicates", async () => {
    const zipBuffer = readFileSync(join(FIXTURES_DIR, "ocha-admin-boundaries-sample.zip"));
    const rows = extractAdminAreaRows(zipBuffer, "2026-01-01");

    await withServiceSession((client) => ingestAdminAreas(client, rows, logger));
    const secondRun = await withServiceSession((client) => ingestAdminAreas(client, rows, logger));
    expect(secondRun.upserted).toBe(rows.length);

    const count = await withServiceSession((client) =>
      client.query("SELECT count(*)::int AS n FROM geo.admin_area WHERE source = $1", [OCHA_SOURCE]),
    );
    expect(count.rows[0]!.n).toBe(rows.length);
  });
});

if (!hasDb) {
  it.skip("skipped: DATABASE_URL is not set (requires local Postgres+PostGIS — see @sodeja/db README)", () => {});
}
