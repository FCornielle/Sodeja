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
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
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

  it("confirms a location (B-7a), always with area_source 'user_entered'", async () => {
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
