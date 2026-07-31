import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { closePool, withServiceSession } from "@sodeja/db";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CapacityModule } from "../capacity/capacity.module.js";
import { CostsModule } from "../costs/costs.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { FinanceModule } from "./finance.module.js";

// Integration tests against a real Postgres, same skip-if-no-DATABASE_URL
// pattern as apps/api/src/costs/costs.controller.test.ts. Requires the
// B-2/B-10/B-11 migrations AND the B-14 ICDV seed migration applied.
describe.skipIf(!process.env.DATABASE_URL)("POST /projects/:id/financial-projection (DB-backed, B-17)", () => {
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
      imports: [ProjectsModule, CapacityModule, CostsModule, FinanceModule],
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

  async function computeCapacity(userId: string, projectId: string, staffCount: number): Promise<void> {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .post(`/projects/${projectId}/capacity-estimate`)
      .set("x-user-id", userId)
      .send({ staffCount });
    expect(res.status).toBe(201);
  }

  async function computeFitout(userId: string, projectId: string, currency?: "DOP" | "USD"): Promise<void> {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .post(`/projects/${projectId}/fitout-estimate`)
      .set("x-user-id", userId)
      .send({ baseCostPerSqmLow: 8000, baseCostPerSqmBase: 10000, baseCostPerSqmHigh: 12000, currency: currency ?? "DOP" });
    expect(res.status).toBe(201);
  }

  async function computeOpex(userId: string, projectId: string): Promise<void> {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .post(`/projects/${projectId}/opex-estimate`)
      .set("x-user-id", userId)
      .send({ companySize: "micro", staffCount: 2, monthlyRentDop: 20000, monthlyUtilitiesDop: 5000 });
    expect(res.status).toBe(201);
  }

  it("409s listing every missing prerequisite when nothing has been computed yet", async () => {
    const userId = await createUser(`fin-nothing-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Sin Nada");
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .post(`/projects/${projectId}/financial-projection`)
      .set("x-user-id", userId)
      .send({ monthlyRevenueLow: 100000, monthlyRevenueBase: 150000, monthlyRevenueHigh: 200000 });

    expect(res.status).toBe(409);
    expect(res.body.missing).toEqual([
      expect.stringContaining("confirmed_area"),
      expect.stringContaining("capacity_estimate"),
      expect.stringContaining("fitout_estimate"),
      expect.stringContaining("opex_estimate"),
    ]);
  });

  it("409s listing only the still-missing prerequisites once area+capacity exist", async () => {
    const userId = await createUser(`fin-partial-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Parcial");
    await confirmLocation(userId, projectId, 100);
    await computeCapacity(userId, projectId, 4);
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .post(`/projects/${projectId}/financial-projection`)
      .set("x-user-id", userId)
      .send({ monthlyRevenueLow: 100000, monthlyRevenueBase: 150000, monthlyRevenueHigh: 200000 });

    expect(res.status).toBe(409);
    expect(res.body.missing).toHaveLength(2);
    expect(res.body.missing.join(" ")).toContain("fitout_estimate");
    expect(res.body.missing.join(" ")).toContain("opex_estimate");
    expect(res.body.missing.join(" ")).not.toContain("confirmed_area");
    expect(res.body.missing.join(" ")).not.toContain("capacity_estimate —");
  });

  it("computes a full projection with break-even reached and a ranked sensitivity list", async () => {
    const userId = await createUser(`fin-full-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Completo");
    await confirmLocation(userId, projectId, 100);
    await computeCapacity(userId, projectId, 4);
    await computeFitout(userId, projectId);
    await computeOpex(userId, projectId);
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .post(`/projects/${projectId}/financial-projection`)
      .set("x-user-id", userId)
      .send({ monthlyRevenueLow: 150000, monthlyRevenueBase: 250000, monthlyRevenueHigh: 350000, horizonMonths: 36 });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe("DOP");
    expect(res.body.engineVersion).toEqual(expect.any(String));
    expect(res.body.rulePackIds).toEqual([]);

    // A healthy revenue vs. a modest fit-out/opex should break even within 36 months.
    expect(res.body.breakevenMonthBase).not.toBeNull();
    if (res.body.breakevenMonthLow !== null && res.body.breakevenMonthHigh !== null) {
      // Lower month = better outcome (breaks even sooner) — low must never exceed high.
      expect(res.body.breakevenMonthLow).toBeLessThanOrEqual(res.body.breakevenMonthHigh);
    }

    expect(res.body.resultsJson.disclaimer).toContain("proyección");
    expect(res.body.resultsJson.sensitivity).toHaveLength(3);
    const ranks = res.body.resultsJson.sensitivity.map((s: { rank: number }) => s.rank);
    expect(ranks).toEqual([1, 2, 3]);
    expect(res.body.resultsJson.monthly).toHaveLength(37); // month 0..36 inclusive
    expect(res.body.resultsJson.monthly[0].revenue).toBeNull(); // month 0 is capex only
    expect(res.body.inputsSnapshot.monthlyRevenueInput.base).toBe(250000);
    expect(res.body.inputsSnapshot.fitoutEstimate.id).toEqual(expect.any(Number));
    expect(res.body.inputsSnapshot.opexEstimate.id).toEqual(expect.any(Number));
    expect(res.body.inputsSnapshot.capacityEstimateId).toEqual(expect.any(Number));
  });

  it("leaves every break-even bound null when revenue never covers costs within the horizon", async () => {
    const userId = await createUser(`fin-neverbreaks-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Nunca Rentable");
    await confirmLocation(userId, projectId, 100);
    await computeCapacity(userId, projectId, 4);
    await computeFitout(userId, projectId);
    await computeOpex(userId, projectId);
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .post(`/projects/${projectId}/financial-projection`)
      .set("x-user-id", userId)
      .send({ monthlyRevenueLow: 1000, monthlyRevenueBase: 2000, monthlyRevenueHigh: 3000, horizonMonths: 12 });

    expect(res.status).toBe(201);
    expect(res.body.breakevenMonthLow).toBeNull();
    expect(res.body.breakevenMonthBase).toBeNull();
    expect(res.body.breakevenMonthHigh).toBeNull();
  });

  it("409s when the fit-out estimate's currency differs from the project's reporting currency and no fx rate is pinned", async () => {
    const userId = await createUser(`fin-fx-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante USD Fitout");
    await confirmLocation(userId, projectId, 100);
    await computeCapacity(userId, projectId, 4);
    await computeFitout(userId, projectId, "USD"); // project reporting_currency defaults DOP; fx_usd_dop is never set in this MVP slice
    await computeOpex(userId, projectId);
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .post(`/projects/${projectId}/financial-projection`)
      .set("x-user-id", userId)
      .send({ monthlyRevenueLow: 100000, monthlyRevenueBase: 150000, monthlyRevenueHigh: 200000 });

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("fx_usd_dop");
  });

  it("400s when horizonMonths exceeds the 60-month cap", async () => {
    const userId = await createUser(`fin-horizon-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, "Restaurante Horizonte Invalido");
    const server = (await startApp()).getHttpServer();

    const res = await request(server)
      .post(`/projects/${projectId}/financial-projection`)
      .set("x-user-id", userId)
      .send({ monthlyRevenueLow: 100000, monthlyRevenueBase: 150000, monthlyRevenueHigh: 200000, horizonMonths: 61 });

    expect(res.status).toBe(400);
  });
});
