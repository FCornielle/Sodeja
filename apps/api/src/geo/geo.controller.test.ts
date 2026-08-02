import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { closePool, withServiceSession } from "@sodeja/db";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GeoModule } from "./geo.module.js";

/**
 * Integration tests against a real Postgres+PostGIS, same
 * skip-if-no-DATABASE_URL pattern as apps/api/src/catalog/catalog.controller.
 * test.ts and services/ingestion's job tests. Inserts small, realistic
 * fixture rows directly (rather than a fixture file — B-7's geo module is a
 * narrow read-only slice, not an ingestion job) and tags them with
 * source='test-fixture' so afterAll cleanup can never touch real ingested
 * data.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const TEST_SOURCE = "test-fixture";

// A tap point with two overlapping footprints underneath (the "multiple
// candidates" UX state), inside the fixture's Distrito Nacional polygon.
const TAP_MULTI: [number, number] = [-69.9, 18.48];
// A point inside the fixture DN polygon but with no footprint underneath
// (falls through to Secondary Flow A per the UX spec, but IS covered).
const TAP_NO_CANDIDATE: [number, number] = [-69.93, 18.5];
// A single-footprint square, used for both tap-to-select and bbox tests.
const SINGLE_FOOTPRINT_POINT: [number, number] = [-69.92, 18.46];
// Outside the fixture DN polygon entirely (and no other admin_area fixture
// exists in this test) -> covered: false.
const OUTSIDE_COVERAGE: [number, number] = [-70.5, 19.6];

function square(centerLon: number, centerLat: number, halfSide: number): number[][][] {
  const [x, y] = [centerLon, centerLat];
  return [
    [
      [x - halfSide, y - halfSide],
      [x + halfSide, y - halfSide],
      [x + halfSide, y + halfSide],
      [x - halfSide, y + halfSide],
      [x - halfSide, y - halfSide],
    ],
  ];
}

describe.skipIf(!hasDb)("GET /geo (DB-backed)", () => {
  let app: INestApplication | undefined;

  beforeAll(async () => {
    await withServiceSession(async (client) => {
      // Fixture "Distrito Nacional" province polygon, large enough to
      // contain every fixture point above except OUTSIDE_COVERAGE.
      await client.query(
        `INSERT INTO geo.admin_area (level, code, name, geom, source, source_license, source_vintage)
         VALUES ('provincia', 'TEST-DN', 'Distrito Nacional',
                 ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), $2, 'CC0', '2026-01-01')`,
        [JSON.stringify({ type: "Polygon", coordinates: square(-69.9, 18.48, 0.1) }), TEST_SOURCE],
      );
      // A non-launch-area province, to prove coverage checks by name, not
      // merely "is inside some admin_area".
      await client.query(
        `INSERT INTO geo.admin_area (level, code, name, geom, source, source_license, source_vintage)
         VALUES ('provincia', 'TEST-LV', 'La Vega',
                 ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), $2, 'CC0', '2026-01-01')`,
        [JSON.stringify({ type: "Polygon", coordinates: square(-70.5, 19.6, 0.05) }), TEST_SOURCE],
      );

      // Two overlapping footprints under TAP_MULTI.
      for (const offset of [-0.0005, 0.0005]) {
        await client.query(
          `INSERT INTO geo.building_footprint (geom, area_sqm, source, source_license, source_vintage)
           VALUES (ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                   ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography), 'osm', 'ODbL', '2026-01-01')`,
          [JSON.stringify({ type: "Polygon", coordinates: square(TAP_MULTI[0] + offset, TAP_MULTI[1], 0.001) })],
        );
      }

      // One footprint at SINGLE_FOOTPRINT_POINT.
      await client.query(
        `INSERT INTO geo.building_footprint (geom, area_sqm, source, source_license, source_vintage)
         VALUES (ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                 ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography), 'open_buildings_v3', 'CC BY 4.0', '2026-01-01')`,
        [JSON.stringify({ type: "Polygon", coordinates: square(SINGLE_FOOTPRINT_POINT[0], SINGLE_FOOTPRINT_POINT[1], 0.001) })],
      );
    });
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await withServiceSession(async (client) => {
      await client.query(
        `DELETE FROM geo.building_footprint
          WHERE ST_Intersects(geom, ST_MakeEnvelope(-70.6, 18.3, -69.7, 19.7, 4326))
            AND source IN ('osm', 'open_buildings_v3')`,
      );
      await client.query("DELETE FROM geo.admin_area WHERE source = $1", [TEST_SOURCE]);
    });
    await closePool();
  });

  async function startApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [GeoModule] }).compile();
    const instance = moduleRef.createNestApplication();
    await instance.init();
    app = instance;
    return instance;
  }

  it("returns multiple candidates for an overlapping-footprint tap point", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server).get("/geo/footprints/at").query({ lon: TAP_MULTI[0], lat: TAP_MULTI[1] });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    for (const footprint of res.body) {
      expect(footprint.areaSqm).toBeGreaterThan(0);
      expect(footprint.source).toBe("osm");
      expect(footprint.sourceLicense).toBe("ODbL");
      expect(footprint.geom.type).toBe("Polygon");
    }
  });

  it("returns an empty array for a tap point with no footprint (falls through to Secondary Flow A)", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .get("/geo/footprints/at")
      .query({ lon: TAP_NO_CANDIDATE[0], lat: TAP_NO_CANDIDATE[1] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("rejects a bbox with min >= max on an axis", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server).get("/geo/footprints").query({ bbox: "-69.91,18.47,-69.93,18.49" });

    expect(res.status).toBe(400);
  });

  it("bbox lookup returns exactly the one footprint inside a tight viewport", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server).get("/geo/footprints").query({
      bbox: `${SINGLE_FOOTPRINT_POINT[0] - 0.002},${SINGLE_FOOTPRINT_POINT[1] - 0.002},${SINGLE_FOOTPRINT_POINT[0] + 0.002},${SINGLE_FOOTPRINT_POINT[1] + 0.002}`,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].source).toBe("open_buildings_v3");
  });

  it("rejects a bbox exceeding the span cap with a 400", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server).get("/geo/footprints").query({ bbox: "-71,17,-68,20" });

    expect(res.status).toBe(400);
  });

  it("coverage: a point inside Distrito Nacional is covered", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .get("/geo/coverage")
      .query({ lon: TAP_NO_CANDIDATE[0], lat: TAP_NO_CANDIDATE[1] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ covered: true, adminAreaId: expect.any(Number), adminAreaName: "Distrito Nacional" });
  });

  it("coverage: a point inside a non-launch-area province is NOT covered (name-filtered, not just any admin_area)", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server).get("/geo/coverage").query({ lon: -70.5, lat: 19.6 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ covered: false, adminAreaId: null, adminAreaName: null });
  });

  it("coverage: a point outside any admin_area fixture is NOT covered", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .get("/geo/coverage")
      .query({ lon: OUTSIDE_COVERAGE[0] + 5, lat: OUTSIDE_COVERAGE[1] + 5 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ covered: false, adminAreaId: null, adminAreaName: null });
  });

  it("400s on an out-of-range lon/lat", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server).get("/geo/coverage").query({ lon: 200, lat: 18.48 });

    expect(res.status).toBe(400);
  });
});

if (!hasDb) {
  it.skip("skipped: DATABASE_URL is not set (requires local Postgres+PostGIS — see @sodeja/db README)", () => {});
}
