import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { closePool, withServiceSession } from "@sodeja/db";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CapacityModule } from "./capacity.module.js";
import { ProjectsModule } from "../projects/projects.module.js";

// Integration tests against a real Postgres, same skip-if-no-DATABASE_URL
// pattern as apps/api/src/projects/projects.controller.test.ts. Requires the
// B-2/B-10/B-11 migrations applied.
describe.skipIf(!process.env.DATABASE_URL)("POST /projects/:id/capacity-estimate (DB-backed)", () => {
  let app: INestApplication | undefined;
  let restauranteId: number;
  let salonId: number;
  let distritoNacionalId: number;

  beforeAll(async () => {
    const ids = await withServiceSession(async (client) => {
      const rt = await client.query<{ id: string }>("SELECT id FROM content.business_type WHERE slug = 'restaurante'");
      const sl = await client.query<{ id: string }>("SELECT id FROM content.business_type WHERE slug = 'salon'");
      const j = await client.query<{ id: string }>("SELECT id FROM content.jurisdiction WHERE slug = 'distrito-nacional'");
      const restaurante = rt.rows[0]?.id;
      const salon = sl.rows[0]?.id;
      const jurisdiction = j.rows[0]?.id;
      if (!restaurante || !salon || !jurisdiction) {
        throw new Error("seed data missing: run the B-10/B-11 migrations before this test suite");
      }
      return { restaurante: Number(restaurante), salon: Number(salon), jurisdiction: Number(jurisdiction) };
    });
    restauranteId = ids.restaurante;
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
    const moduleRef = await Test.createTestingModule({ imports: [ProjectsModule, CapacityModule] }).compile();
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

  it("409s when the project's area is not confirmed yet (B-7a gate)", async () => {
    const userId = await createUser(`capacity-no-area-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, restauranteId, "Restaurante Sin Area");
    const server = (await startApp()).getHttpServer();

    const res = await request(server).post(`/projects/${projectId}/capacity-estimate`).set("x-user-id", userId).send({});

    expect(res.status).toBe(409);
  });

  it("computes seats from the IBC seat ratio (1.39 m2/asiento) for restaurante, floor-rounded", async () => {
    const userId = await createUser(`capacity-restaurante-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, restauranteId, "Restaurante Capacidad");
    await confirmLocation(userId, projectId, 139); // 139 / 1.39 = 100 exactly
    const server = (await startApp()).getHttpServer();

    const res = await request(server).post(`/projects/${projectId}/capacity-estimate`).set("x-user-id", userId).send({});

    expect(res.status).toBe(201);
    expect(res.body.seatsBase).toBe(100);
    expect(res.body.seatsLow).toBe(100);
    expect(res.body.seatsHigh).toBe(100);
    expect(res.body.engineVersion).toEqual(expect.any(String));
    expect(res.body.staffBase).toBeNull();
    expect(res.body.resultsJson.staffReason).toContain("staffCount");
  });

  it("populates staff_* only when staffCount is supplied explicitly", async () => {
    const userId = await createUser(`capacity-staff-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, restauranteId, "Restaurante Con Staff");
    await confirmLocation(userId, projectId, 139);
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .post(`/projects/${projectId}/capacity-estimate`)
      .set("x-user-id", userId)
      .send({ staffCount: 6 });

    expect(res.status).toBe(201);
    expect(res.body.staffLow).toBe(6);
    expect(res.body.staffBase).toBe(6);
    expect(res.body.staffHigh).toBe(6);
    expect(res.body.dailyCustomersBase).toBeNull();
  });

  it("leaves seats_* null for salon (no ratio seeded), with a documented reason — not an error", async () => {
    const userId = await createUser(`capacity-salon-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, salonId, "Salon Sin Ratio");
    await confirmLocation(userId, projectId, 80);
    const server = (await startApp()).getHttpServer();

    const res = await request(server).post(`/projects/${projectId}/capacity-estimate`).set("x-user-id", userId).send({});

    expect(res.status).toBe(201);
    expect(res.body.seatsBase).toBeNull();
    expect(res.body.resultsJson.seatsReason).toContain("no capacity ratio is seeded");
  });
});
