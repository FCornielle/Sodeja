import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, withServiceSession } from "@sodeja/db";
import { createLogger } from "@sodeja/observability";
import { ingestPoiPlaces } from "./ingestPoiPlaces.js";
import { ingestAdminAreas } from "./ingestAdminAreas.js";
import { OCHA_SOURCE } from "../transform/adminAreaRow.js";
import { extractAdminAreaRows } from "../sources/ochaAdminAreas.js";
import { OVERTURE_SOURCE, type OvertureRawPlace, type PoiPlaceRow, mapOverturePlaceRow } from "../transform/poiPlaceRow.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");
const logger = createLogger("ingestPoiPlaces.test");

async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

function loadFixtureRows(): PoiPlaceRow[] {
  const content = readFileSync(join(FIXTURES_DIR, "overture-places-sample.ndjson"), "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => mapOverturePlaceRow(JSON.parse(line) as OvertureRawPlace, "2026-07-22"));
}

describe.runIf(hasDb)("ingestPoiPlaces (integration)", () => {
  beforeAll(async () => {
    // admin_area_id resolution is a spatial join against geo.admin_area, so
    // the OCHA fixture chain (pais/provincia/municipio/3 secciones) needs to
    // exist first — same setup ingestBuildingFootprints.test.ts uses.
    const zipBuffer = readFileSync(join(FIXTURES_DIR, "ocha-admin-boundaries-sample.zip"));
    const rows = extractAdminAreaRows(zipBuffer, "2026-01-01");
    await withServiceSession((client) => ingestAdminAreas(client, rows, logger));
  });

  afterAll(async () => {
    await withServiceSession(async (client) => {
      await client.query("DELETE FROM geo.poi_place WHERE source = $1", [OVERTURE_SOURCE]);
      await client.query("DELETE FROM geo.admin_area WHERE source = $1", [OCHA_SOURCE]);
    });
    await closePool();
  });

  it("loads real fixture Overture Places rows with category/raw_category/confidence all persisted", async () => {
    const rows = loadFixtureRows();

    const result = await withServiceSession((client) =>
      ingestPoiPlaces(client, toAsyncIterable(rows), logger),
    );
    expect(result.staged).toBe(rows.length);
    expect(result.upserted).toBe(rows.length);

    const dbRows = await withServiceSession((client) =>
      client.query(
        `SELECT external_id, category, raw_category, confidence, source_license, source_vintage
         FROM geo.poi_place WHERE source = $1`,
        [OVERTURE_SOURCE],
      ),
    );
    expect(dbRows.rows).toHaveLength(rows.length);

    // category is NULL for unmapped rows but raw_category is never dropped —
    // the P0-1 spike's explicit instruction not to silently discard it.
    const church = dbRows.rows.find((r) => r.raw_category === "church_cathedral");
    expect(church).toBeTruthy();
    expect(church!.category).toBeNull();

    const restaurant = dbRows.rows.find((r) => r.raw_category === "restaurant");
    expect(restaurant!.category).toBe("restaurante");

    // confidence is stored for both high- and low-confidence rows alike —
    // never filtered at ingestion time.
    const lowConfidenceRow = dbRows.rows.find((r) => r.raw_category === "fast_food_restaurant" && Number(r.confidence) < 0.2);
    expect(lowConfidenceRow).toBeTruthy();
    expect(Number(lowConfidenceRow!.confidence)).toBeGreaterThanOrEqual(0);

    for (const row of dbRows.rows) {
      expect(row.source_license).toContain("Mixed");
      expect(row.source_vintage.toISOString().slice(0, 10)).toBe("2026-07-22");
    }
  });

  it("resolves admin_area_id via spatial containment when the point falls inside a loaded geo.admin_area polygon", async () => {
    // Synthetic point (not from the real fixture) placed inside the OCHA
    // fixture's "Las Coles (D.M.)" seccion polygon, same technique
    // ingestBuildingFootprints.test.ts uses to prove the containment join.
    const syntheticRow: PoiPlaceRow = mapOverturePlaceRow(
      {
        id: "synthetic-test-poi-1",
        name: "Test Colmado",
        category: "convenience_store",
        confidence: 0.9,
        lon: -69.736,
        lat: 19.183,
      },
      "2026-07-22",
    );

    await withServiceSession((client) => ingestPoiPlaces(client, toAsyncIterable([syntheticRow]), logger));

    const matched = await withServiceSession((client) =>
      client.query(
        `SELECT a.code FROM geo.poi_place p
         JOIN geo.admin_area a ON a.id = p.admin_area_id
         WHERE p.source = $1 AND p.external_id = $2`,
        [OVERTURE_SOURCE, "synthetic-test-poi-1"],
      ),
    );
    expect(matched.rows[0]!.code).toBe("DO01010202"); // "Las Coles (D.M.)"
  });

  it("is idempotent per-source: re-running replaces rather than duplicates", async () => {
    const rows = loadFixtureRows();
    await withServiceSession((client) => ingestPoiPlaces(client, toAsyncIterable(rows), logger));
    const firstCount = await withServiceSession((client) =>
      client.query("SELECT count(*)::int AS n FROM geo.poi_place WHERE source = $1", [OVERTURE_SOURCE]),
    );

    await withServiceSession((client) => ingestPoiPlaces(client, toAsyncIterable(rows), logger));
    const secondCount = await withServiceSession((client) =>
      client.query("SELECT count(*)::int AS n FROM geo.poi_place WHERE source = $1", [OVERTURE_SOURCE]),
    );

    expect(secondCount.rows[0]!.n).toBe(firstCount.rows[0]!.n);
  });
});

if (!hasDb) {
  it.skip("skipped: DATABASE_URL is not set (requires local Postgres+PostGIS — see @sodeja/db README)", () => {});
}
