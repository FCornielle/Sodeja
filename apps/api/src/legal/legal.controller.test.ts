import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { closePool } from "@sodeja/db";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { LegalModule } from "./legal.module.js";

// Integration test against a real Postgres, same skip-if-no-DATABASE_URL
// pattern as apps/api/src/catalog/catalog.controller.test.ts. Requires the
// B-20 seed migration applied
// (packages/db/migrations/1785570000000_seed-disclaimer-legal-document.sql).
describe.skipIf(!process.env.DATABASE_URL)("GET /legal/documents/:kind/current (DB-backed, B-20)", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await closePool();
  });

  async function startApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [LegalModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    return app;
  }

  it("returns the seeded es-DO disclaimer with its full body_md", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server).get("/legal/documents/disclaimer/current");

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("disclaimer");
    expect(res.body.locale).toBe("es-DO");
    expect(res.body.version).toEqual(expect.any(String));
    expect(res.body.bodyMd).toContain("Aviso legal");
    expect(res.body.bodyMd).toContain("No es un plan de negocio auditado");
    // Must not fabricate DR-specific legal review — see the seed migration's own header.
    expect(res.body.bodyMd).not.toMatch(/Ley \d/);
  });

  it("defaults locale to es-DO when omitted", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server).get("/legal/documents/disclaimer/current");
    expect(res.status).toBe(200);
    expect(res.body.locale).toBe("es-DO");
  });

  it("400s on an invalid kind", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server).get("/legal/documents/not-a-real-kind/current");
    expect(res.status).toBe(400);
  });

  it("404s for a kind with no seeded content (tos)", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server).get("/legal/documents/tos/current");
    expect(res.status).toBe(404);
  });

  it("404s for an unseeded locale", async () => {
    const server = (await startApp()).getHttpServer();
    const res = await request(server).get("/legal/documents/disclaimer/current?locale=en-US");
    expect(res.status).toBe(404);
  });
});
