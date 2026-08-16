import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { allocateLayoutZones, checkLayoutZonePlausibility } from "@sodeja/calc";
import { closePool, withServiceSession } from "@sodeja/db";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CapacityModule } from "../capacity/capacity.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { LayoutModule } from "./layout.module.js";

// Integration tests against a real Postgres, same skip-if-no-DATABASE_URL
// pattern as apps/api/src/capacity/capacity.controller.test.ts. Requires the
// B-2/B-10/B-11/B-13 migrations applied.
describe.skipIf(!process.env.DATABASE_URL)("GET /projects/:id/layout-parameters (DB-backed)", () => {
  let app: INestApplication | undefined;
  let restauranteId: number;
  let colmadoId: number;
  let salonId: number;
  let distritoNacionalId: number;

  beforeAll(async () => {
    const ids = await withServiceSession(async (client) => {
      const { rows } = await client.query<{ slug: string; id: string }>(
        "SELECT slug, id FROM content.business_type WHERE slug = ANY($1::text[])",
        [["restaurante", "colmado", "salon"]],
      );
      const j = await client.query<{ id: string }>("SELECT id FROM content.jurisdiction WHERE slug = 'distrito-nacional'");
      const bySlug = new Map(rows.map((r) => [r.slug, Number(r.id)]));
      const restaurante = bySlug.get("restaurante");
      const colmado = bySlug.get("colmado");
      const salon = bySlug.get("salon");
      const jurisdiction = j.rows[0]?.id;
      if (restaurante === undefined || colmado === undefined || salon === undefined || !jurisdiction) {
        throw new Error("seed data missing: run the B-10/B-11/B-13 migrations before this test suite");
      }
      return { restaurante, colmado, salon, jurisdiction: Number(jurisdiction) };
    });
    restauranteId = ids.restaurante;
    colmadoId = ids.colmado;
    salonId = ids.salon;
    distritoNacionalId = ids.jurisdiction;
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
      const { rows } = await client.query<{ id: string }>("INSERT INTO auth.users (email) VALUES ($1) RETURNING id", [email]);
      const id = rows[0]?.id;
      if (!id) throw new Error("user insert returned no id");
      return id;
    });
  }

  async function startApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [ProjectsModule, CapacityModule, LayoutModule],
    }).compile();
    const instance = moduleRef.createNestApplication();
    await instance.init();
    app = instance;
    return instance;
  }

  async function createProject(userId: string, businessTypeId: number, name: string): Promise<string> {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .post("/projects")
      .set("x-user-id", userId)
      .send({ name, businessTypeId, jurisdictionId: distritoNacionalId });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function confirmLocation(userId: string, projectId: string, areaSqm: number): Promise<void> {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({ areaSqm, centroidLon: -69.9312, centroidLat: 18.4861 });
    expect(res.status).toBe(200);
  }

  async function computeCapacity(userId: string, projectId: string, body: object): Promise<void> {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .post(`/projects/${projectId}/capacity-estimate`)
      .set("x-user-id", userId)
      .send(body);
    expect(res.status).toBe(201);
  }

  it("409s when the project's area is not confirmed yet (B-7a gate)", async () => {
    const userId = await createUser(`layout-no-area-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, colmadoId, "Colmado Sin Area");
    const server = (await startApp()).getHttpServer();

    const res = await request(server).get(`/projects/${projectId}/layout-parameters`).set("x-user-id", userId);

    expect(res.status).toBe(409);
  });

  it("returns the cited almacén density for colmado, with the confirmed area", async () => {
    const userId = await createUser(`layout-colmado-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, colmadoId, "Colmado Layout");
    await confirmLocation(userId, projectId, 120);
    const server = (await startApp()).getHttpServer();

    const res = await request(server).get(`/projects/${projectId}/layout-parameters`).set("x-user-id", userId);

    expect(res.status).toBe(200);
    expect(res.body.areaSqm).toBe(120);
    expect(res.body.businessTypeSlug).toBe("colmado");
    expect(res.body.densityParameters).toHaveLength(1);
    const density = res.body.densityParameters[0];
    expect(density.parameterTableSlug).toBe("layout_m2_por_ocupante_almacen");
    expect(density.valueBase).toBe(27.87);
    expect(density.currency).toBeNull();
    expect(density.citation.sourceDocument).toEqual(expect.any(String));
  });

  it("returns the cocina density for restaurante", async () => {
    const userId = await createUser(`layout-restaurante-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, restauranteId, "Restaurante Layout");
    await confirmLocation(userId, projectId, 200);
    const server = (await startApp()).getHttpServer();

    const res = await request(server).get(`/projects/${projectId}/layout-parameters`).set("x-user-id", userId);

    expect(res.status).toBe(200);
    expect(res.body.densityParameters.map((p: { parameterTableSlug: string }) => p.parameterTableSlug)).toEqual([
      "layout_m2_por_ocupante_cocina",
    ]);
  });

  it("returns an empty densityParameters for salon (no cited zone) — 200, not an error", async () => {
    const userId = await createUser(`layout-salon-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, salonId, "Salon Layout");
    await confirmLocation(userId, projectId, 80);
    const server = (await startApp()).getHttpServer();

    const res = await request(server).get(`/projects/${projectId}/layout-parameters`).set("x-user-id", userId);

    expect(res.status).toBe(200);
    expect(res.body.densityParameters).toEqual([]);
  });

  it("reports expectedOccupants as null, with a reason, when no capacity estimate exists yet", async () => {
    const userId = await createUser(`layout-no-capacity-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, colmadoId, "Colmado Sin Aforo");
    await confirmLocation(userId, projectId, 120);
    const server = (await startApp()).getHttpServer();

    const res = await request(server).get(`/projects/${projectId}/layout-parameters`).set("x-user-id", userId);

    expect(res.status).toBe(200);
    expect(res.body.expectedOccupants).toBeNull();
    expect(res.body.expectedOccupantsReason).toContain("no capacity estimate exists");
  });

  it("reports expectedOccupants as null when the latest capacity estimate has no staff figure", async () => {
    const userId = await createUser(`layout-no-staff-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, colmadoId, "Colmado Sin Personal");
    await confirmLocation(userId, projectId, 120);
    await computeCapacity(userId, projectId, {});
    const server = (await startApp()).getHttpServer();

    const res = await request(server).get(`/projects/${projectId}/layout-parameters`).set("x-user-id", userId);

    expect(res.status).toBe(200);
    expect(res.body.expectedOccupants).toBeNull();
    expect(res.body.expectedOccupantsReason).toContain("staff_base");
  });

  it("carries staff_base (not seats) through as expectedOccupants, and the response drives @sodeja/calc", async () => {
    const userId = await createUser(`layout-staff-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, colmadoId, "Colmado Con Personal");
    await confirmLocation(userId, projectId, 120);
    await computeCapacity(userId, projectId, { staffCount: 2 });
    const server = (await startApp()).getHttpServer();

    const res = await request(server).get(`/projects/${projectId}/layout-parameters`).set("x-user-id", userId);

    expect(res.status).toBe(200);
    expect(res.body.expectedOccupants).toBe(2);
    expect(res.body.expectedOccupantsReason).toBeNull();

    // The point of the endpoint: everything the client needs to run the
    // allocation and the plausibility check itself, with no server round trip
    // for either.
    const allocations = allocateLayoutZones(res.body.areaSqm, [
      { slug: "almacen", sharePercent: 25 },
      { slug: "venta", sharePercent: 70 },
    ]);
    expect(allocations.find((a) => a.slug === "almacen")?.areaSqm).toBe(30);

    const notes = checkLayoutZonePlausibility(
      allocations,
      [
        {
          zoneSlug: "almacen",
          density: res.body.densityParameters[0],
          expectedOccupants: res.body.expectedOccupants,
        },
      ],
      1.5,
    );
    // 30 m2 / 27.87 = 1.0764 implied occupants against 2 expected staff —
    // 0.54x, below the 1/1.5 threshold, so the engine emits one informational
    // note. Asserted end-to-end to prove the wire shape actually feeds the
    // engine (citation included), not just that it type-checks.
    expect(notes).toHaveLength(1);
    expect(notes[0]?.direction).toBe("menor");
    expect(notes[0]?.parameterTableSlug).toBe("layout_m2_por_ocupante_almacen");
    expect(notes[0]?.message).toContain("comparación informativa");
  });
});
