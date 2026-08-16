import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { closePool, withServiceSession } from "@sodeja/db";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CapacityModule } from "../capacity/capacity.module.js";
import { CostsModule } from "../costs/costs.module.js";
import { FinanceModule } from "../finance/finance.module.js";
import { LayoutModule } from "../layout/layout.module.js";
import { LegalModule } from "../legal/legal.module.js";
import { PermitsModule } from "../permits/permits.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { ReportsModule } from "./reports.module.js";

// Full-pipeline integration test against a real Postgres AND a real
// Chromium render (services/pdf-worker's renderReportPdf) — same
// skip-if-no-DATABASE_URL pattern as apps/api/src/finance/finance.controller.test.ts.
// Requires the B-2/B-10/B-11/B-14/B-18 migrations AND the B-20 disclaimer
// seed (packages/db/migrations/1785570000000_seed-disclaimer-legal-document.sql)
// applied.
describe.skipIf(!process.env.DATABASE_URL)("reports (DB-backed + real Chromium render, B-19/B-20)", () => {
  let app: INestApplication | undefined;
  let restauranteId: number;
  let distritoNacionalId: number;

  const modules = [ProjectsModule, CapacityModule, CostsModule, FinanceModule, LayoutModule, PermitsModule, LegalModule, ReportsModule];

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
    const moduleRef = await Test.createTestingModule({ imports: modules }).compile();
    const instance = moduleRef.createNestApplication();
    await instance.init();
    app = instance;
    return instance;
  }

  async function createProject(server: unknown, userId: string, name: string): Promise<string> {
    const res = await request(server)
      .post("/projects")
      .set("x-user-id", userId)
      .send({ name, businessTypeId: restauranteId, jurisdictionId: distritoNacionalId });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function confirmLocation(server: unknown, userId: string, projectId: string, areaSqm: number): Promise<void> {
    const res = await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({ areaSqm, centroidLon: -69.9312, centroidLat: 18.4861 });
    expect(res.status).toBe(200);
  }

  async function pollUntilTerminal(server: unknown, userId: string, projectId: string, reportId: string, timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await request(server).get(`/projects/${projectId}/reports/${reportId}`).set("x-user-id", userId);
      expect(res.status).toBe(200);
      if (res.body.status === "ready" || res.body.status === "failed") return res.body;
      if (Date.now() > deadline) throw new Error(`report ${reportId} did not reach a terminal status within ${timeoutMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  it(
    "409s a report request when the project's area is not confirmed",
    async () => {
      const server = (await startApp()).getHttpServer();
      const userId = await createUser(`rpt-noarea-${crypto.randomUUID()}@example.test`);
      const projectId = await createProject(server, userId, "Sin Area Confirmada");

      const res = await request(server).post(`/projects/${projectId}/reports`).set("x-user-id", userId).send({});
      expect(res.status).toBe(409);
    },
    30_000,
  );

  it(
    "400s a request for the 'plan_negocio' tier (Phase 2, not built)",
    async () => {
      const server = (await startApp()).getHttpServer();
      const userId = await createUser(`rpt-plannegocio-${crypto.randomUUID()}@example.test`);
      const projectId = await createProject(server, userId, "Plan De Negocio Rechazado");
      await confirmLocation(server, userId, projectId, 100);

      const res = await request(server)
        .post(`/projects/${projectId}/reports`)
        .set("x-user-id", userId)
        .send({ tier: "plan_negocio" });
      expect(res.status).toBe(400);
    },
    30_000,
  );

  it(
    "renders a real, non-empty PDF end to end for a project with only a confirmed area (every other section gracefully degrades)",
    async () => {
      const server = (await startApp()).getHttpServer();
      const userId = await createUser(`rpt-minimal-${crypto.randomUUID()}@example.test`);
      const projectId = await createProject(server, userId, "Reporte Minimo");
      await confirmLocation(server, userId, projectId, 80);

      const createRes = await request(server).post(`/projects/${projectId}/reports`).set("x-user-id", userId).send({});
      expect(createRes.status).toBe(202);
      expect(createRes.body.status).toBe("queued");
      expect(createRes.body.tier).toBe("resumen_analisis");
      const reportId = createRes.body.id as string;

      const finalStatus = await pollUntilTerminal(server, userId, projectId, reportId);
      expect(finalStatus.status).toBe("ready");
      // Reaching 'ready' proves app.report's own CHECK constraint held
      // (status <> 'ready' OR (storage_key IS NOT NULL AND
      // disclaimer_document_id IS NOT NULL)) — the API never sets storage_key
      // without also setting disclaimer_document_id, so this row could not
      // exist as 'ready' otherwise.
      expect(finalStatus.disclaimerDocumentId).toEqual(expect.any(Number));
      expect(finalStatus.engineVersion).toEqual(expect.any(String));

      const downloadRes = await request(server)
        .get(`/projects/${projectId}/reports/${reportId}/download`)
        .set("x-user-id", userId)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => callback(null, Buffer.concat(chunks)));
        });
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers["content-type"]).toContain("application/pdf");
      const body = downloadRes.body as Buffer;
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.length).toBeGreaterThan(1000);
      expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    },
    60_000,
  );

  it(
    "409s a download attempt while the report has not reached 'ready'",
    async () => {
      const server = (await startApp()).getHttpServer();
      const userId = await createUser(`rpt-notready-${crypto.randomUUID()}@example.test`);
      const projectId = await createProject(server, userId, "Descarga Prematura");
      await confirmLocation(server, userId, projectId, 80);

      const createRes = await request(server).post(`/projects/${projectId}/reports`).set("x-user-id", userId).send({});
      expect(createRes.status).toBe(202);
      const reportId = createRes.body.id as string;

      // Immediately (before the async render has necessarily finished) —
      // may race a very fast render, so accept either 409 (still
      // queued/rendering) or 200 (already finished); the point is it must
      // never 500 or hang.
      const res = await request(server).get(`/projects/${projectId}/reports/${reportId}/download`).set("x-user-id", userId);
      expect([200, 409]).toContain(res.status);

      await pollUntilTerminal(server, userId, projectId, reportId);
    },
    60_000,
  );

  it(
    "404s for a report id that does not exist",
    async () => {
      const server = (await startApp()).getHttpServer();
      const userId = await createUser(`rpt-404-${crypto.randomUUID()}@example.test`);
      const projectId = await createProject(server, userId, "Reporte Inexistente");
      await confirmLocation(server, userId, projectId, 80);

      const res = await request(server)
        .get(`/projects/${projectId}/reports/00000000-0000-0000-0000-000000000000`)
        .set("x-user-id", userId);
      expect(res.status).toBe(404);
    },
    30_000,
  );
});
