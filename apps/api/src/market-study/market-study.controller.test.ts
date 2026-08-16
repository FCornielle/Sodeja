import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { closePool, withServiceSession } from "@sodeja/db";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ProjectsModule } from "../projects/projects.module.js";
import { MarketStudyModule } from "./market-study.module.js";

// Integration tests against a real Postgres, same skip-if-no-DATABASE_URL
// pattern as apps/api/src/costs/costs.controller.test.ts. Requires the
// B-2/B-10/B-11 migrations applied. geo.poi_place/population_grid/
// data_coverage_cell rows are inserted directly as fixtures here, mirroring
// what services/ingestion's B-5/B-9 jobs would normally produce — this
// suite does not depend on those jobs having actually been run.
const TEST_SOURCE = "test-fixture-b9-market-study";

// A point well away from any other test's fixture geometry, and from the
// well-covered fixture below, so it genuinely has zero coverage cells.
const UNCOVERED_LON = -68.5;
const UNCOVERED_LAT = 19.9;

// A small square around this point gets population/coverage/POI fixtures.
const COVERED_LON = -69.91;
const COVERED_LAT = 18.46;
const HALF_SIDE_DEG = 0.002; // ~220m side, comfortably within the default 500m radius

function square(centerLon: number, centerLat: number, halfSide: number): number[][][] {
  return [
    [
      [centerLon - halfSide, centerLat - halfSide],
      [centerLon + halfSide, centerLat - halfSide],
      [centerLon + halfSide, centerLat + halfSide],
      [centerLon - halfSide, centerLat + halfSide],
      [centerLon - halfSide, centerLat - halfSide],
    ],
  ];
}

describe.skipIf(!process.env.DATABASE_URL)("market-study (B-9) (DB-backed)", () => {
  let app: INestApplication | undefined;
  let restauranteId: number;
  let distritoNacionalId: number;

  beforeAll(async () => {
    const ids = await withServiceSession(async (client) => {
      const rt = await client.query<{ id: string }>("SELECT id FROM content.business_type WHERE slug = 'restaurante'");
      const j = await client.query<{ id: string }>("SELECT id FROM content.jurisdiction WHERE slug = 'distrito-nacional'");
      const restaurante = rt.rows[0]?.id;
      const jurisdiction = j.rows[0]?.id;
      if (!restaurante || !jurisdiction) {
        throw new Error("seed data missing: run the B-10/B-11 migrations before this test suite");
      }
      return { restaurante: Number(restaurante), jurisdiction: Number(jurisdiction) };
    });
    restauranteId = ids.restaurante;
    distritoNacionalId = ids.jurisdiction;

    await withServiceSession(async (client) => {
      // Admin area + census, backing the covered fixture point.
      const admin = await client.query<{ id: string }>(
        `INSERT INTO geo.admin_area (level, code, name, geom, source, source_license, source_vintage)
         VALUES ('provincia', 'TEST-MS-ADMIN', 'Distrito Nacional',
                 ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), $2, 'CC0', '2026-01-01')
         RETURNING id`,
        [JSON.stringify({ type: "Polygon", coordinates: square(COVERED_LON, COVERED_LAT, HALF_SIDE_DEG * 3) }), TEST_SOURCE],
      );
      const adminAreaId = admin.rows[0]!.id;
      await client.query(
        `INSERT INTO geo.census_population (admin_area_id, population, census_year, source, source_vintage)
         VALUES ($1, 12000, 2022, $2, '2022-01-01')`,
        [adminAreaId, TEST_SOURCE],
      );

      // A population_grid cell over the covered point.
      await client.query(
        `INSERT INTO geo.population_grid (cell, population_est, poi_count)
         VALUES (ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 800, 5)`,
        [JSON.stringify({ type: "Polygon", coordinates: square(COVERED_LON, COVERED_LAT, HALF_SIDE_DEG) })],
      );

      // A data_coverage_cell over the covered point, tier 'alta'.
      await client.query(
        `INSERT INTO geo.data_coverage_cell (cell, footprint_score, poi_score, census_score, tier, is_launch_area)
         VALUES (ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 1, 1, 1, 'alta', true)`,
        [JSON.stringify({ type: "Polygon", coordinates: square(COVERED_LON, COVERED_LAT, HALF_SIDE_DEG) })],
      );

      // Two POIs near the covered point: one restaurante (competitor), one
      // colmado (not a competitor for a restaurante project) — proves the
      // category filter, not just presence.
      await client.query(
        `INSERT INTO geo.poi_place (external_id, name, category, raw_category, geom, source, source_license, source_vintage)
         VALUES
           ($1, 'Restaurante Fixture', 'restaurante', 'restaurant', ST_SetSRID(ST_MakePoint($3, $4), 4326), $2, 'CC0', '2026-01-01'),
           ($5, 'Colmado Fixture', 'colmado', 'convenience_store', ST_SetSRID(ST_MakePoint($3, $4), 4326), $2, 'CC0', '2026-01-01')`,
        [`${TEST_SOURCE}-1`, TEST_SOURCE, COVERED_LON + 0.0005, COVERED_LAT, `${TEST_SOURCE}-2`],
      );
    });
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await withServiceSession(async (client) => {
      await client.query("DELETE FROM geo.poi_place WHERE source = $1", [TEST_SOURCE]);
      await client.query("DELETE FROM geo.population_grid WHERE population_est = 800 AND poi_count = 5");
      await client.query("DELETE FROM geo.data_coverage_cell WHERE tier = 'alta' AND footprint_score = 1 AND poi_score = 1 AND census_score = 1 " +
        "AND ST_Intersects(cell, ST_MakeEnvelope($1, $2, $3, $4, 4326))", [
        COVERED_LON - HALF_SIDE_DEG - 0.001,
        COVERED_LAT - HALF_SIDE_DEG - 0.001,
        COVERED_LON + HALF_SIDE_DEG + 0.001,
        COVERED_LAT + HALF_SIDE_DEG + 0.001,
      ]);
      await client.query("DELETE FROM geo.census_population WHERE source = $1", [TEST_SOURCE]);
      await client.query("DELETE FROM geo.admin_area WHERE source = $1", [TEST_SOURCE]);
    });
    await closePool();
  });

  async function startApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [ProjectsModule, MarketStudyModule],
    }).compile();
    const instance = moduleRef.createNestApplication();
    await instance.init();
    app = instance;
    return instance;
  }

  async function createUser(email: string): Promise<string> {
    return withServiceSession(async (client) => {
      const { rows } = await client.query<{ id: string }>("INSERT INTO auth.users (email) VALUES ($1) RETURNING id", [email]);
      const id = rows[0]?.id;
      if (!id) throw new Error("user insert returned no id");
      return id;
    });
  }

  async function createProject(userId: string, name: string): Promise<string> {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .post("/projects")
      .set("x-user-id", userId)
      .send({ name, businessTypeId: restauranteId, jurisdictionId: distritoNacionalId });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function confirmLocation(userId: string, projectId: string, lon: number, lat: number): Promise<void> {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({ areaSqm: 100, centroidLon: lon, centroidLat: lat });
    expect(res.status).toBe(200);
  }

  it("409s when the project's area is not confirmed yet (B-7a gate)", async () => {
    const userId = await createUser(`ms-no-area-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Sin Area");
    const server = (await startApp()).getHttpServer();

    const res = await request(server).post(`/projects/${projectId}/market-study`).set("x-user-id", userId);

    expect(res.status).toBe(409);
  });

  it("computes population/competitor/confidence/demand-index over a well-covered fixture area", async () => {
    const userId = await createUser(`ms-covered-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Cubierto");
    await confirmLocation(userId, projectId, COVERED_LON, COVERED_LAT);
    const server = (await startApp()).getHttpServer();

    const res = await request(server).post(`/projects/${projectId}/market-study?radiusM=500`).set("x-user-id", userId);

    expect(res.status).toBe(201);
    expect(res.body.populationEst).toBe(800);
    expect(res.body.competitorCount).toBe(1); // only the 'restaurante' POI, not the 'colmado' one
    expect(res.body.competitorsUserAdded).toBe(0);
    expect(res.body.confidence).toBe("alta");
    expect(res.body.censusYear).toBe(2022);
    expect(res.body.demandIndexBase).toBeCloseTo(800 / 1, 5);
    // 'alta' tier band is +/-10% of base (market-study.service.ts's DEMAND_INDEX_BAND_FRACTION).
    expect(res.body.demandIndexLow).toBeCloseTo(720, 5);
    expect(res.body.demandIndexHigh).toBeCloseTo(880, 5);
  });

  it("degrades to 'insuficiente' with a null demand index over an uncovered area", async () => {
    const userId = await createUser(`ms-uncovered-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Sin Cobertura");
    await confirmLocation(userId, projectId, UNCOVERED_LON, UNCOVERED_LAT);
    const server = (await startApp()).getHttpServer();

    const res = await request(server).post(`/projects/${projectId}/market-study`).set("x-user-id", userId);

    expect(res.status).toBe(201);
    expect(res.body.populationEst).toBe(0);
    expect(res.body.competitorCount).toBe(0);
    expect(res.body.confidence).toBe("insuficiente");
    expect(res.body.demandIndexLow).toBeNull();
    expect(res.body.demandIndexBase).toBeNull();
    expect(res.body.demandIndexHigh).toBeNull();
  });

  it("404s adding a manual competitor before any market study has been computed", async () => {
    const userId = await createUser(`ms-manual-404-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Sin Estudio");
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .patch(`/projects/${projectId}/market-study/manual-competitors`)
      .set("x-user-id", userId)
      .send({ delta: 1 });

    expect(res.status).toBe(404);
  });

  it("manually-added competitors survive a recomputation and feed the demand index", async () => {
    const userId = await createUser(`ms-manual-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Manual");
    await confirmLocation(userId, projectId, COVERED_LON, COVERED_LAT);
    const server = (await startApp()).getHttpServer();

    await request(server).post(`/projects/${projectId}/market-study`).set("x-user-id", userId);

    const patchRes = await request(server)
      .patch(`/projects/${projectId}/market-study/manual-competitors`)
      .set("x-user-id", userId)
      .send({ delta: 2 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.competitorsUserAdded).toBe(2);

    // Recompute — competitorsUserAdded must survive (upsertMarketStudy's
    // doc comment: a recompute must never reset manually-logged competitors)
    // and the demand index must now divide by (1 dataset + 2 manual) = 3.
    const recomputeRes = await request(server).post(`/projects/${projectId}/market-study`).set("x-user-id", userId);
    expect(recomputeRes.status).toBe(201);
    expect(recomputeRes.body.competitorsUserAdded).toBe(2);
    // demand_index_* is numeric(10,4) (specs/db/schema.sql), which rounds
    // the repeating decimal 800/3 slightly — 2 decimal places is well within
    // that rounding, not a precision bug.
    expect(recomputeRes.body.demandIndexBase).toBeCloseTo(800 / 3, 2);
  });
});
