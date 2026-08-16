import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { closePool, withServiceSession } from "@sodeja/db";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ProjectsModule } from "./projects.module.js";

// Integration tests against a real Postgres, same pattern as
// packages/db/src/schema.test.ts: skipped (not failed) without DATABASE_URL.
// Requires the B-2/B-10/B-11 migrations applied.
// B-8 POI-label fixtures. `geo.poi_place` rows are inserted directly here,
// mirroring what services/ingestion's B-5 job would produce — this suite does
// not depend on that job having been run.
const POI_TEST_SOURCE = "test-fixture-b8-poi-label";

// A site with POIs around it, well away from every other suite's fixture
// geometry (market-study.controller.test.ts uses -69.91/18.46 and -68.5/19.9).
const POI_SITE_LON = -69.95;
const POI_SITE_LAT = 18.5;

// 1 degree of longitude is ~105,570m at 18.5°N, so these are ~15m and ~30m
// east of the site — both inside POI_LABEL_RADIUS_M (40m).
const DEG_PER_M_LON = 1 / 105_570;
const NEAR_POI_LON = POI_SITE_LON + 15 * DEG_PER_M_LON;
const FARTHER_POI_LON = POI_SITE_LON + 30 * DEG_PER_M_LON;

// ~200m east of the site: outside the radius, so it must never be returned.
const OUT_OF_RANGE_POI_LON = POI_SITE_LON + 200 * DEG_PER_M_LON;

describe.skipIf(!process.env.DATABASE_URL)("projects (DB-backed)", () => {
  let app: INestApplication | undefined;
  let restauranteId: number;
  let distritoNacionalId: number;

  beforeAll(async () => {
    // content.business_type.id / content.jurisdiction.id are `bigint`, which
    // node-postgres returns as a string (not a JS number) by default — the
    // same reason apps/api/src/projects/projects.repository.ts explicitly
    // Number()-converts every bigint-sourced id before it reaches a
    // z.number() field. Converting here too, so this test sends the same
    // shape of body a real, well-behaved client would.
    const ids = await withServiceSession(async (client) => {
      const bt = await client.query<{ id: string }>(
        "SELECT id FROM content.business_type WHERE slug = 'restaurante'",
      );
      const j = await client.query<{ id: string }>(
        "SELECT id FROM content.jurisdiction WHERE slug = 'distrito-nacional'",
      );
      const businessTypeId = bt.rows[0]?.id;
      const jurisdictionId = j.rows[0]?.id;
      if (!businessTypeId || !jurisdictionId) {
        throw new Error("seed data missing: run the B-10 migration before this test suite");
      }
      return { businessTypeId: Number(businessTypeId), jurisdictionId: Number(jurisdictionId) };
    });
    restauranteId = ids.businessTypeId;
    distritoNacionalId = ids.jurisdictionId;

    await withServiceSession(async (client) => {
      await client.query(
        `INSERT INTO geo.poi_place (external_id, name, category, raw_category, geom, source, source_license, source_vintage)
         VALUES
           ($1, 'Colmado Cercano', 'colmado', 'convenience_store', ST_SetSRID(ST_MakePoint($4, $7), 4326), $8, 'CC0', '2026-01-15'),
           ($2, 'Restaurante Mas Lejos', 'restaurante', 'restaurant', ST_SetSRID(ST_MakePoint($5, $7), 4326), $8, 'CC0', '2026-01-15'),
           ($3, 'Farmacia Fuera De Rango', NULL, 'pharmacy', ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, 'CC0', '2026-01-15')`,
        [
          `${POI_TEST_SOURCE}-near`,
          `${POI_TEST_SOURCE}-farther`,
          `${POI_TEST_SOURCE}-out-of-range`,
          NEAR_POI_LON,
          FARTHER_POI_LON,
          OUT_OF_RANGE_POI_LON,
          POI_SITE_LAT,
          POI_TEST_SOURCE,
        ],
      );
    });
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await withServiceSession(async (client) => {
      await client.query("DELETE FROM geo.poi_place WHERE source = $1", [POI_TEST_SOURCE]);
    });
    await closePool();
  });

  async function createUser(email: string): Promise<string> {
    return withServiceSession(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO auth.users (email) VALUES ($1) RETURNING id",
        [email],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("user insert returned no id");
      return id;
    });
  }

  async function startApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [ProjectsModule] }).compile();
    const instance = moduleRef.createNestApplication();
    await instance.init();
    app = instance;
    return instance;
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

  it("rejects a request with no x-user-id header (auth module not built yet)", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .post("/projects")
      .send({ name: "x", businessTypeId: restauranteId, jurisdictionId: distritoNacionalId });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid POST /projects body (missing businessTypeId)", async () => {
    const userId = await createUser(`bad-body-${crypto.randomUUID()}@example.test`);
    const server = (await startApp()).getHttpServer();
    const res = await request(server).post("/projects").set("x-user-id", userId).send({ name: "x" });
    expect(res.status).toBe(400);
  });

  it("creates a project and returns it", async () => {
    const userId = await createUser(`create-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Prueba");
    expect(projectId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("materializes assumptions on first read, across every seeded domain (not capacity-only)", async () => {
    const userId = await createUser(`materialize-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Materializado");
    const server = (await startApp()).getHttpServer();

    const res = await request(server).get(`/projects/${projectId}/assumptions`).set("x-user-id", userId);

    expect(res.status).toBe(200);
    const byKey = new Map<string, (typeof res.body)[number]>(
      (res.body as Array<{ key: string }>).map((a) => [a.key, a]),
    );

    const seatRatio = byKey.get("capacity_m2_por_asiento");
    expect(seatRatio).toBeDefined();
    expect(seatRatio?.valueBase).toBeCloseTo(1.39, 2);
    expect(seatRatio?.provenance).toBe("estimado");
    expect(seatRatio?.isOverridden).toBe(false);
    expect(seatRatio?.implausibleFlag).toBe(false);
    expect(seatRatio?.defaultParameterValueId).toEqual(expect.any(Number));

    // B-10's national labor-domain rates resolve too (distrito-nacional's
    // jurisdiction chain includes 'nacional') — materialization is
    // deliberately not filtered to domain='capacity' (see
    // projects.service.ts getAssumptions doc comment).
    expect(byKey.has("tss_ceiling_base")).toBe(true);

    // A second read must NOT re-materialize (idempotent): same row count.
    const second = await request(server).get(`/projects/${projectId}/assumptions`).set("x-user-id", userId);
    expect(second.body).toHaveLength(res.body.length);
  });

  it("hides another user's project (RLS), returning 404 rather than leaking existence", async () => {
    const ownerId = await createUser(`owner-${crypto.randomUUID()}@example.test`);
    const otherId = await createUser(`other-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(ownerId, "Restaurante Privado");
    const server = (await startApp()).getHttpServer();

    const res = await request(server).get(`/projects/${projectId}/assumptions`).set("x-user-id", otherId);

    expect(res.status).toBe(404);
  });

  it("overrides an assumption, flags implausible_flag against the ORIGINAL band, and returns invalidated[]", async () => {
    const userId = await createUser(`override-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Override");
    const server = (await startApp()).getHttpServer();

    await request(server).get(`/projects/${projectId}/assumptions`).set("x-user-id", userId);

    // Original band for capacity_m2_por_asiento is [1.39, 1.39, 1.39]; 2.5 is
    // outside it, so implausible_flag must be set (a warning, never a 400).
    const res = await request(server)
      .patch(`/projects/${projectId}/assumptions/capacity_m2_por_asiento`)
      .set("x-user-id", userId)
      .send({ valueLow: 2.0, valueBase: 2.5, valueHigh: 3.0 });

    expect(res.status).toBe(200);
    expect(res.body.assumption.valueBase).toBe(2.5);
    expect(res.body.assumption.isOverridden).toBe(true);
    expect(res.body.assumption.implausibleFlag).toBe(true);
    expect(res.body.invalidated).toEqual(
      expect.arrayContaining(["capacity_estimate", "financial_projection"]),
    );
    // A capacity-domain assumption must never claim to invalidate fitout or opex.
    expect(res.body.invalidated).not.toContain("fitout_estimate");
    expect(res.body.invalidated).not.toContain("opex_estimate");
  });

  it("rejects an override where low > base (matches the table's CHECK)", async () => {
    const userId = await createUser(`bad-override-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Bad Override");
    const server = (await startApp()).getHttpServer();

    await request(server).get(`/projects/${projectId}/assumptions`).set("x-user-id", userId);

    const res = await request(server)
      .patch(`/projects/${projectId}/assumptions/capacity_m2_por_asiento`)
      .set("x-user-id", userId)
      .send({ valueLow: 5, valueBase: 1, valueHigh: 10 });

    expect(res.status).toBe(400);
  });

  it("confirms a location (B-7a), defaulting area_source to 'user_entered' when none is sent", async () => {
    const userId = await createUser(`location-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Ubicacion");
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({ areaSqm: 120.5, centroidLon: -69.9312, centroidLat: 18.4861 });

    expect(res.status).toBe(200);
    expect(res.body.projectId).toBe(projectId);
    expect(res.body.areaSqm).toBe(120.5);
    expect(res.body.areaSource).toBe("user_entered");
    expect(res.body.areaConfirmedAt).toEqual(expect.any(String));
    expect(res.body.centroidLon).toBeCloseTo(-69.9312, 4);
    expect(res.body.centroidLat).toBeCloseTo(18.4861, 4);
  });

  it("persists and round-trips an explicit area_source (B-8), not the default", async () => {
    const userId = await createUser(`location-source-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Huella");
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({
        areaSqm: 88,
        centroidLon: -69.9312,
        centroidLat: 18.4861,
        areaSource: "footprint_dataset",
      });

    expect(res.status).toBe(200);
    expect(res.body.areaSource).toBe("footprint_dataset");

    // It reached app.project_location, not just the response DTO.
    const stored = await withServiceSession(async (client) => {
      const { rows } = await client.query<{ area_source: string }>(
        "SELECT area_source FROM app.project_location WHERE project_id = $1",
        [projectId],
      );
      return rows[0]?.area_source;
    });
    expect(stored).toBe("footprint_dataset");

    // Re-confirming with a redrawn area overwrites the provenance too — a
    // stale 'footprint_dataset' on a hand-drawn area would misreport where
    // the number came from.
    const redrawn = await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({ areaSqm: 95, centroidLon: -69.9312, centroidLat: 18.4861, areaSource: "user_drawn" });
    expect(redrawn.status).toBe(200);
    expect(redrawn.body.areaSource).toBe("user_drawn");
  });

  it("400s a PUT /location with an area_source outside the enum", async () => {
    const userId = await createUser(`location-bad-source-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Fuente Invalida");
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({ areaSqm: 100, centroidLon: -69.9, centroidLat: 18.4, areaSource: "guessed" });

    expect(res.status).toBe(400);
  });

  it("PUT /location is idempotent (re-confirming updates rather than erroring)", async () => {
    const userId = await createUser(`location-reconfirm-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Reconfirmar");
    const server = (await startApp()).getHttpServer();

    await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({ areaSqm: 100, centroidLon: -69.9, centroidLat: 18.4 });

    const res = await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({ areaSqm: 200, centroidLon: -69.8, centroidLat: 18.5 });

    expect(res.status).toBe(200);
    expect(res.body.areaSqm).toBe(200);
  });

  it("404s a PUT /location for a project the caller does not own (RLS)", async () => {
    const ownerId = await createUser(`location-owner-${crypto.randomUUID()}@example.test`);
    const otherId = await createUser(`location-other-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(ownerId, "Restaurante Ubicacion Privada");
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", otherId)
      .send({ areaSqm: 100, centroidLon: -69.9, centroidLat: 18.4 });

    expect(res.status).toBe(404);
  });

  it("400s a PUT /location with an out-of-range latitude", async () => {
    const userId = await createUser(`location-bad-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Ubicacion Invalida");
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({ areaSqm: 100, centroidLon: -69.9, centroidLat: 95 });

    expect(res.status).toBe(400);
  });

  it("409s GET /poi-label before the area is confirmed (B-7a gate)", async () => {
    const userId = await createUser(`poi-no-area-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Sin Area POI");
    const server = (await startApp()).getHttpServer();

    const res = await request(server).get(`/projects/${projectId}/poi-label`).set("x-user-id", userId);

    expect(res.status).toBe(409);
  });

  it("returns the NEAREST POI's use-label for a confirmed site (B-8)", async () => {
    const userId = await createUser(`poi-label-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Con Etiqueta");
    const server = (await startApp()).getHttpServer();

    await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({ areaSqm: 100, centroidLon: POI_SITE_LON, centroidLat: POI_SITE_LAT });

    const res = await request(server).get(`/projects/${projectId}/poi-label`).set("x-user-id", userId);

    expect(res.status).toBe(200);
    // The colmado at ~15m wins over the restaurante at ~30m — both are inside
    // the radius, so this proves nearest-one ordering, not just presence.
    expect(res.body.category).toBe("colmado");
    expect(res.body.name).toBe("Colmado Cercano");
    expect(res.body.distanceM).toBeGreaterThan(0);
    expect(res.body.distanceM).toBeLessThan(25);
    expect(res.body.sourceVintage).toBe("2026-01-15");
  });

  it("returns all-null (not a 404) when no POI is within the label radius", async () => {
    const userId = await createUser(`poi-empty-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Sin POI");
    const server = (await startApp()).getHttpServer();

    // ~200m east of the fixture site: the out-of-range farmacia is the only
    // POI anywhere near, and it sits outside the 40m radius from here.
    await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({ areaSqm: 100, centroidLon: POI_SITE_LON + 400 * DEG_PER_M_LON, centroidLat: POI_SITE_LAT });

    const res = await request(server).get(`/projects/${projectId}/poi-label`).set("x-user-id", userId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ category: null, name: null, distanceM: null, sourceVintage: null });
  });

  it("404s GET /poi-label for a project the caller does not own (RLS)", async () => {
    const ownerId = await createUser(`poi-owner-${crypto.randomUUID()}@example.test`);
    const otherId = await createUser(`poi-other-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(ownerId, "Restaurante POI Privado");
    const server = (await startApp()).getHttpServer();

    await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", ownerId)
      .send({ areaSqm: 100, centroidLon: POI_SITE_LON, centroidLat: POI_SITE_LAT });

    const res = await request(server).get(`/projects/${projectId}/poi-label`).set("x-user-id", otherId);

    expect(res.status).toBe(404);
  });

  it("404s a PATCH on a key that was never materialized", async () => {
    const userId = await createUser(`missing-key-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Missing Key");
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .patch(`/projects/${projectId}/assumptions/no_such_key`)
      .set("x-user-id", userId)
      .send({ valueLow: 1, valueBase: 1, valueHigh: 1 });

    expect(res.status).toBe(404);
  });
});
