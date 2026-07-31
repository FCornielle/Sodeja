import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, withServiceSession } from "@sodeja/db";
import { createLogger } from "@sodeja/observability";
import { ingestBuildingFootprints } from "./ingestBuildingFootprints.js";
import { ingestAdminAreas } from "./ingestAdminAreas.js";
import { OCHA_SOURCE } from "../transform/adminAreaRow.js";
import { extractAdminAreaRows } from "../sources/ochaAdminAreas.js";
import { readNdjson } from "../lib/ndjson.js";
import type { GeoJsonFeature, PolygonGeometry } from "../lib/geojson.js";
import {
  MS_GLOBALML_LICENSE,
  MS_GLOBALML_SOURCE,
  MS_GLOBALML_VINTAGE,
  mapMsGlobalMlFeature,
  type FootprintRow,
} from "../transform/footprintRow.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");
const logger = createLogger("ingestBuildingFootprints.test");

async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe.runIf(hasDb)("ingestBuildingFootprints (integration)", () => {
  beforeAll(async () => {
    // admin_area_id resolution is a spatial join against geo.admin_area, so
    // the OCHA fixture chain (pais/provincia/municipio/3 secciones) needs to
    // exist first to exercise the "pick the most specific containing level"
    // behavior.
    const zipBuffer = readFileSync(join(FIXTURES_DIR, "ocha-admin-boundaries-sample.zip"));
    const rows = extractAdminAreaRows(zipBuffer, "2026-01-01");
    await withServiceSession((client) => ingestAdminAreas(client, rows, logger));
  });

  afterAll(async () => {
    await withServiceSession(async (client) => {
      await client.query("DELETE FROM geo.building_footprint WHERE source = $1", [MS_GLOBALML_SOURCE]);
      await client.query("DELETE FROM geo.admin_area WHERE source = $1", [OCHA_SOURCE]);
    });
    await closePool();
  });

  it("loads real fixture MS GlobalML rows with area_sqm computed and admin_area_id resolved to pais", async () => {
    const content = readFileSync(join(FIXTURES_DIR, "ms-globalml-sample.geojsonl"), "utf8");
    const { Readable } = await import("node:stream");
    const rows: FootprintRow[] = [];
    for await (const feature of readNdjson<GeoJsonFeature<{ height: number; confidence: number }, PolygonGeometry>>(
      Readable.from(content),
    )) {
      rows.push(mapMsGlobalMlFeature(feature));
    }

    const result = await withServiceSession((client) =>
      ingestBuildingFootprints(client, [toAsyncIterable(rows)], logger),
    );
    expect(result.staged).toBe(rows.length);
    expect(result.upserted).toBe(rows.length);

    const dbRows = await withServiceSession((client) =>
      client.query(
        `SELECT bf.area_sqm, bf.confidence, bf.source_license, bf.source_vintage, a.level AS admin_level
         FROM geo.building_footprint bf
         LEFT JOIN geo.admin_area a ON a.id = bf.admin_area_id
         WHERE bf.source = $1`,
        [MS_GLOBALML_SOURCE],
      ),
    );
    expect(dbRows.rows).toHaveLength(rows.length);
    for (const row of dbRows.rows) {
      expect(Number(row.area_sqm)).toBeGreaterThan(0);
      expect(row.confidence).toBeNull(); // real 2026-02-03 build reports -1 -> null
      expect(row.source_license).toBe(MS_GLOBALML_LICENSE);
      expect(row.source_vintage.toISOString().slice(0, 10)).toBe(MS_GLOBALML_VINTAGE);
      // The fixture's coordinates fall within the OCHA pais bbox but outside
      // every narrower fixture polygon (provincia/municipio/seccion cover
      // only a small slice of Provincia Duarte) — 'pais' is the only, and
      // therefore most specific, containing level available in this dataset.
      expect(row.admin_level).toBe("pais");
    }
  });

  it("picks the most specific (smallest-area) containing admin area when several nest", async () => {
    // Synthetic (not from a real dataset) — a small square centered inside
    // the "Las Coles (D.M.)" seccion fixture polygon, chosen so it also
    // falls inside its parent municipio/provincia/pais polygons. Proves the
    // ORDER BY ST_Area(a.geom) ASC tie-break picks the narrowest match
    // rather than an arbitrary one.
    const syntheticRow: FootprintRow = {
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-69.737, 19.182],
            [-69.735, 19.182],
            [-69.735, 19.184],
            [-69.737, 19.184],
            [-69.737, 19.182],
          ],
        ],
      },
      confidence: 0.95,
      source: MS_GLOBALML_SOURCE,
      sourceLicense: MS_GLOBALML_LICENSE,
      sourceVintage: MS_GLOBALML_VINTAGE,
    };

    await withServiceSession((client) =>
      ingestBuildingFootprints(client, [toAsyncIterable([syntheticRow])], logger),
    );

    const matched = await withServiceSession((client) =>
      client.query(
        `SELECT a.code FROM geo.building_footprint bf
         JOIN geo.admin_area a ON a.id = bf.admin_area_id
         WHERE bf.source = $1 AND bf.confidence = 0.95`,
        [MS_GLOBALML_SOURCE],
      ),
    );
    expect(matched.rows[0]!.code).toBe("DO01010202"); // "Las Coles (D.M.)"
  });

  it("is idempotent per-source: re-running replaces rather than duplicates", async () => {
    const rowA: FootprintRow = {
      geometry: {
        type: "Polygon",
        coordinates: [[[-70, 19], [-69.999, 19], [-69.999, 19.001], [-70, 19]]],
      },
      confidence: null,
      source: MS_GLOBALML_SOURCE,
      sourceLicense: MS_GLOBALML_LICENSE,
      sourceVintage: MS_GLOBALML_VINTAGE,
    };

    await withServiceSession((client) =>
      ingestBuildingFootprints(client, [toAsyncIterable([rowA])], logger),
    );
    const firstCount = await withServiceSession((client) =>
      client.query("SELECT count(*)::int AS n FROM geo.building_footprint WHERE source = $1", [
        MS_GLOBALML_SOURCE,
      ]),
    );

    await withServiceSession((client) =>
      ingestBuildingFootprints(client, [toAsyncIterable([rowA])], logger),
    );
    const secondCount = await withServiceSession((client) =>
      client.query("SELECT count(*)::int AS n FROM geo.building_footprint WHERE source = $1", [
        MS_GLOBALML_SOURCE,
      ]),
    );

    expect(secondCount.rows[0]!.n).toBe(firstCount.rows[0]!.n);
  });
});

if (!hasDb) {
  it.skip("skipped: DATABASE_URL is not set (requires local Postgres+PostGIS — see @sodeja/db README)", () => {});
}
