import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { closePool, withServiceSession } from "@sodeja/db";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CapacityModule } from "../capacity/capacity.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { CostsModule } from "./costs.module.js";

// Integration tests against a real Postgres, same skip-if-no-DATABASE_URL
// pattern as apps/api/src/projects/projects.controller.test.ts. Requires the
// B-2/B-10/B-11 migrations AND the B-14 ICDV seed migration
// (1785540000000_seed-construction-icdv.sql) applied.
describe.skipIf(!process.env.DATABASE_URL)("costs: fit-out (B-14) + opex (B-15) (DB-backed)", () => {
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
      imports: [ProjectsModule, CapacityModule, CostsModule],
    }).compile();
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

  async function confirmLocation(userId: string, projectId: string, areaSqm: number): Promise<void> {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({ areaSqm, centroidLon: -69.9312, centroidLat: 18.4861 });
    expect(res.status).toBe(200);
  }

  describe("fit-out estimate", () => {
    it("409s when the project's area is not confirmed yet (B-7a gate)", async () => {
      const userId = await createUser(`fitout-no-area-${crypto.randomUUID()}@example.test`);
      const projectId = await createProject(userId, "Restaurante Fitout Sin Area");
      const server = (await startApp()).getHttpServer();

      const res = await request(server)
        .post(`/projects/${projectId}/fitout-estimate`)
        .set("x-user-id", userId)
        .send({ baseCostPerSqmLow: 10000, baseCostPerSqmBase: 12000, baseCostPerSqmHigh: 15000 });

      expect(res.status).toBe(409);
    });

    it("applies the ICDV escalation factor to the user-supplied base cost x area", async () => {
      const userId = await createUser(`fitout-${crypto.randomUUID()}@example.test`);
      const projectId = await createProject(userId, "Restaurante Fitout");
      await confirmLocation(userId, projectId, 100);
      const server = (await startApp()).getHttpServer();

      const res = await request(server)
        .post(`/projects/${projectId}/fitout-estimate`)
        .set("x-user-id", userId)
        .send({ baseCostPerSqmLow: 10000, baseCostPerSqmBase: 10000, baseCostPerSqmHigh: 10000, currency: "DOP" });

      expect(res.status).toBe(201);
      // 10000 DOP/m2 x 100 m2 x 1.0372 (ICDV escalation) = 1,037,200
      expect(res.body.totalBaseAmount).toBeCloseTo(1037200, 0);
      expect(res.body.currency).toBe("DOP");
      expect(res.body.indexBaseDate).toBe("2025-12-01");
      expect(res.body.resultsJson.disclaimer).toContain("indicativa");
      expect(res.body.totalLowAmount).toBeLessThanOrEqual(res.body.totalBaseAmount);
      expect(res.body.totalBaseAmount).toBeLessThanOrEqual(res.body.totalHighAmount);
    });

    it("400s when baseCostPerSqmLow > baseCostPerSqmBase", async () => {
      const userId = await createUser(`fitout-bad-${crypto.randomUUID()}@example.test`);
      const projectId = await createProject(userId, "Restaurante Fitout Invalido");
      await confirmLocation(userId, projectId, 100);
      const server = (await startApp()).getHttpServer();

      const res = await request(server)
        .post(`/projects/${projectId}/fitout-estimate`)
        .set("x-user-id", userId)
        .send({ baseCostPerSqmLow: 20000, baseCostPerSqmBase: 10000, baseCostPerSqmHigh: 30000 });

      expect(res.status).toBe(400);
    });
  });

  describe("opex estimate", () => {
    it("409s when neither a capacity estimate's staff count nor rent/utilities are available", async () => {
      const userId = await createUser(`opex-nothing-${crypto.randomUUID()}@example.test`);
      const projectId = await createProject(userId, "Restaurante Opex Vacio");
      await confirmLocation(userId, projectId, 100);
      const server = (await startApp()).getHttpServer();

      const res = await request(server)
        .post(`/projects/${projectId}/opex-estimate`)
        .set("x-user-id", userId)
        .send({ companySize: "micro" });

      expect(res.status).toBe(409);
    });

    it("computes payroll + TSS employee-side + INFOTEP from a request-level staffCount override", async () => {
      const userId = await createUser(`opex-request-staff-${crypto.randomUUID()}@example.test`);
      const projectId = await createProject(userId, "Restaurante Opex Staff Directo");
      await confirmLocation(userId, projectId, 100);
      const server = (await startApp()).getHttpServer();

      const res = await request(server)
        .post(`/projects/${projectId}/opex-estimate`)
        .set("x-user-id", userId)
        .send({ companySize: "micro", staffCount: 2 });

      expect(res.status).toBe(201);
      expect(res.body.resultsJson.payroll.staffCountSource).toBe("request");
      // 2 employees x 16,993.20 DOP micro minimum wage = 33,986.40 gross
      expect(res.body.resultsJson.payroll.grossMonthly.base.amount).toBeCloseTo(33986.4, 1);
      expect(res.body.resultsJson.employerAfpNote).toContain("no está modelado");
      expect(res.body.resultsJson.restaurantWageCaveat).toContain("gastronómicos");
      expect(res.body.resultsJson.partial).toBe(true); // no rent/utilities supplied
      expect(res.body.monthlyBaseAmount).toBeGreaterThan(res.body.resultsJson.payroll.total.base.amount - 1);
    });

    it("uses app.capacity_estimate.staff_* when no staffCount override is supplied", async () => {
      const userId = await createUser(`opex-from-capacity-${crypto.randomUUID()}@example.test`);
      const projectId = await createProject(userId, "Restaurante Opex Desde Capacidad");
      await confirmLocation(userId, projectId, 139);
      const server = (await startApp()).getHttpServer();

      await request(server)
        .post(`/projects/${projectId}/capacity-estimate`)
        .set("x-user-id", userId)
        .send({ staffCount: 4 });

      const res = await request(server)
        .post(`/projects/${projectId}/opex-estimate`)
        .set("x-user-id", userId)
        .send({ companySize: "pequena" });

      expect(res.status).toBe(201);
      expect(res.body.resultsJson.payroll.staffCountSource).toBe("capacity_estimate");
    });

    it("includes rent/utilities only when supplied, and reflects a non-partial total when both plus payroll are present", async () => {
      const userId = await createUser(`opex-full-${crypto.randomUUID()}@example.test`);
      const projectId = await createProject(userId, "Restaurante Opex Completo");
      await confirmLocation(userId, projectId, 100);
      const server = (await startApp()).getHttpServer();

      const res = await request(server)
        .post(`/projects/${projectId}/opex-estimate`)
        .set("x-user-id", userId)
        .send({ companySize: "micro", staffCount: 1, monthlyRentDop: 30000, monthlyUtilitiesDop: 8000 });

      expect(res.status).toBe(201);
      expect(res.body.resultsJson.rent.base.amount).toBe(30000);
      expect(res.body.resultsJson.utilities.base.amount).toBe(8000);
      expect(res.body.resultsJson.partial).toBe(false);
    });
  });
});
