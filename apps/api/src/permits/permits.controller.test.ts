import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { closePool, withServiceSession } from "@sodeja/db";
import type { PermitChecklist, PermitChecklistItem } from "@sodeja/schemas";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ProjectsModule } from "../projects/projects.module.js";
import { PermitsModule } from "./permits.module.js";

// Integration tests against a real Postgres, same skip-if-no-DATABASE_URL
// pattern as apps/api/src/layout/layout.controller.test.ts. Requires the
// B-2/B-10/B-11 migrations AND the B-18 permits seed migration
// (1785560000000_seed-permits-content.sql) applied.
describe.skipIf(!process.env.DATABASE_URL)("GET /projects/:id/permits-checklist (DB-backed)", () => {
  let app: INestApplication | undefined;
  let restauranteId: number;
  let ferreteriaId: number;
  let distritoNacionalId: number;
  let santiagoId: number;

  beforeAll(async () => {
    const ids = await withServiceSession(async (client) => {
      const bt = await client.query<{ slug: string; id: string }>(
        "SELECT slug, id FROM content.business_type WHERE slug = ANY($1::text[])",
        [["restaurante", "ferreteria"]],
      );
      const j = await client.query<{ slug: string; id: string }>(
        "SELECT slug, id FROM content.jurisdiction WHERE slug = ANY($1::text[])",
        [["distrito-nacional", "santiago"]],
      );
      const btBySlug = new Map(bt.rows.map((r) => [r.slug, Number(r.id)]));
      const jBySlug = new Map(j.rows.map((r) => [r.slug, Number(r.id)]));
      const restaurante = btBySlug.get("restaurante");
      const ferreteria = btBySlug.get("ferreteria");
      const dn = jBySlug.get("distrito-nacional");
      const santiago = jBySlug.get("santiago");
      if (restaurante === undefined || ferreteria === undefined || dn === undefined || santiago === undefined) {
        throw new Error("seed data missing: run the B-10/B-11/B-18 migrations before this test suite");
      }
      return { restaurante, ferreteria, dn, santiago };
    });
    restauranteId = ids.restaurante;
    ferreteriaId = ids.ferreteria;
    distritoNacionalId = ids.dn;
    santiagoId = ids.santiago;
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
      imports: [ProjectsModule, PermitsModule],
    }).compile();
    const instance = moduleRef.createNestApplication();
    await instance.init();
    app = instance;
    return instance;
  }

  async function createProject(
    userId: string,
    businessTypeId: number,
    jurisdictionId: number,
    name: string,
  ): Promise<string> {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .post("/projects")
      .set("x-user-id", userId)
      .send({ name, businessTypeId, jurisdictionId });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function confirmLocation(userId: string, projectId: string, lon: number, lat: number): Promise<void> {
    const server = (await startApp()).getHttpServer();
    const res = await request(server)
      .put(`/projects/${projectId}/location`)
      .set("x-user-id", userId)
      .send({ areaSqm: 120, centroidLon: lon, centroidLat: lat });
    expect(res.status).toBe(200);
  }

  async function checklistFor(
    label: string,
    businessTypeId: number,
    jurisdictionId: number,
    lon: number,
    lat: number,
  ): Promise<PermitChecklist> {
    const userId = await createUser(`permits-${label}-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, businessTypeId, jurisdictionId, `Permisos ${label}`);
    await confirmLocation(userId, projectId, lon, lat);
    const server = (await startApp()).getHttpServer();
    const res = await request(server).get(`/projects/${projectId}/permits-checklist`).set("x-user-id", userId);
    expect(res.status).toBe(200);
    return res.body as PermitChecklist;
  }

  function itemByCode(checklist: PermitChecklist, code: string): PermitChecklistItem {
    const item = checklist.items.find((i) => i.ruleCode === code);
    if (!item) throw new Error(`no checklist item with ruleCode '${code}'`);
    return item;
  }

  it("409s when the project's area is not confirmed yet (B-7a gate)", async () => {
    const userId = await createUser(`permits-no-area-${crypto.randomUUID()}@example.test`);
    const projectId = await createProject(userId, ferreteriaId, distritoNacionalId, "Ferretería Sin Área");
    const server = (await startApp()).getHttpServer();

    const res = await request(server).get(`/projects/${projectId}/permits-checklist`).set("x-user-id", userId);

    expect(res.status).toBe(409);
  });

  it("returns the national unconditional rules, each with a citation, and never a 'compliant' requirement", async () => {
    const checklist = await checklistFor("nacional", ferreteriaId, distritoNacionalId, -69.9312, 18.4861);

    expect(checklist.isExhaustive).toBe(false);
    expect(checklist.disclaimerEs).toContain("NO es exhaustiva");
    expect(checklist.jurisdictionSlug).toBe("distrito-nacional");
    expect(checklist.businessTypeSlug).toBe("ferreteria");

    // Ordered by content.rule.display_order, which is what the seed uses to
    // put the checklist in the sequence a user actually walks it.
    expect(checklist.items.map((i) => i.ruleCode)).toEqual([
      "registro-mercantil",
      "rnc-inscripcion",
      "dgii-inicio-actividades",
      "uso-suelo",
      "licencia-apertura-municipal",
      "bomberos-inspeccion",
    ]);

    for (const item of checklist.items) {
      expect(item.requirement).not.toBe("compliant");
      expect(["required", "likely_required", "not_applicable", "unknown"]).toContain(item.requirement);
      // "Citation is mandatory, not decorative" (packages/rules/README.md).
      expect(item.citation.sourceDocument).toEqual(expect.any(String));
      expect(item.citation.retrievedAt).toEqual(expect.any(String));
    }
  });

  it("fires the food-handling rules for restaurante and not for ferretería (the only conditional rules seeded)", async () => {
    const restaurante = await checklistFor("restaurante", restauranteId, distritoNacionalId, -69.9312, 18.4861);
    const ferreteria = await checklistFor("ferreteria-food", ferreteriaId, distritoNacionalId, -69.9312, 18.4861);

    const foodCodes = ["salud-establecimiento-alimentos", "salud-certificado-manipuladores"];
    expect(restaurante.items.map((i) => i.ruleCode)).toEqual(expect.arrayContaining(foodCodes));
    for (const code of foodCodes) {
      expect(ferreteria.items.map((i) => i.ruleCode)).not.toContain(code);
    }
  });

  it("surfaces the real DN-vs-Santiago uso-de-suelo divergence: different instrument name AND different issuing office", async () => {
    const dn = await checklistFor("dn-uso-suelo", ferreteriaId, distritoNacionalId, -69.9312, 18.4861);
    const santiago = await checklistFor("stgo-uso-suelo", ferreteriaId, santiagoId, -70.6884, 19.4517);

    const dnUsoSuelo = itemByCode(dn, "uso-suelo");
    const santiagoUsoSuelo = itemByCode(santiago, "uso-suelo");

    // The whole point of the two municipal packs: sending a Santiago user to
    // ask for a "Certificación de Uso de Suelo" would send them to ask for
    // something the OMPU does not issue.
    expect(dnUsoSuelo.titleEs).toContain("Certificación de Uso de Suelo");
    expect(santiagoUsoSuelo.titleEs).toContain("No Objeción al Uso de Suelo");
    expect(dnUsoSuelo.titleEs).not.toBe(santiagoUsoSuelo.titleEs);

    expect(dnUsoSuelo.agencyName).toContain("Dirección de Planeamiento Urbano");
    expect(santiagoUsoSuelo.agencyName).toContain("OMPU");
    expect(dnUsoSuelo.agencyName).not.toBe(santiagoUsoSuelo.agencyName);

    expect(dnUsoSuelo.citation.sourceName).toContain("Distrito Nacional");
    expect(santiagoUsoSuelo.citation.sourceName).toContain("Santiago");

    // The municipal row wins on shared `code`, so the national uso-suelo rule
    // is replaced rather than listed alongside it.
    expect(dnUsoSuelo.jurisdictionSlug).toBe("distrito-nacional");
    expect(santiagoUsoSuelo.jurisdictionSlug).toBe("santiago");
    expect(dn.items.filter((i) => i.ruleCode === "uso-suelo")).toHaveLength(1);
    expect(santiago.items.filter((i) => i.ruleCode === "uso-suelo")).toHaveLength(1);

    // Everything else is national law and identical in both — only the one
    // genuinely divergent rule is overridden.
    const dnMunicipal = itemByCode(dn, "licencia-apertura-municipal");
    const santiagoMunicipal = itemByCode(santiago, "licencia-apertura-municipal");
    expect(dnMunicipal.jurisdictionSlug).toBe("nacional");
    expect(santiagoMunicipal.jurisdictionSlug).toBe("nacional");
    expect(dnMunicipal.titleEs).toBe(santiagoMunicipal.titleEs);
  });
});
