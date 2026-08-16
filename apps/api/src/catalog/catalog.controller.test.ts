import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { closePool } from "@sodeja/db";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { CatalogModule } from "./catalog.module.js";

interface CatalogEntryBody {
  id: number;
  slug: string;
  parameters: Array<{
    parameterTableSlug: string;
    valueBase: number;
    provenance: string;
    citation: { sourceDocument: string };
  }>;
}

interface JurisdictionBody {
  id: number;
  slug: string;
  nameEs: string;
}

// Integration tests against a real Postgres, same pattern as
// packages/db/src/schema.test.ts and packages/rules/src/repository.test.ts:
// skipped (not failed) without DATABASE_URL. Requires the B-10 + B-11
// migrations applied (packages/db/migrations/*_seed-*.sql).
describe.skipIf(!process.env.DATABASE_URL)("GET /business-types (DB-backed)", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await closePool();
  });

  async function listBusinessTypes(): Promise<CatalogEntryBody[]> {
    const moduleRef = await Test.createTestingModule({ imports: [CatalogModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const res = await request(app.getHttpServer()).get("/business-types");
    expect(res.status).toBe(200);
    return res.body as CatalogEntryBody[];
  }

  it("lists all 5 MVP business types", async () => {
    const businessTypes = await listBusinessTypes();
    const slugs = businessTypes.map((bt) => bt.slug).sort();
    expect(slugs).toEqual(["colmado", "ferreteria", "minimarket", "restaurante", "salon"]);
  });

  it("resolves the B-11 seat ratio for restaurante (IBC Table 1004.5, m2/asiento)", async () => {
    const businessTypes = await listBusinessTypes();
    const restaurante = businessTypes.find((bt) => bt.slug === "restaurante");
    const seatRatio = restaurante?.parameters.find(
      (p) => p.parameterTableSlug === "capacity_m2_por_asiento",
    );
    expect(seatRatio).toBeDefined();
    expect(seatRatio?.valueBase).toBeCloseTo(1.39, 2);
    expect(seatRatio?.provenance).toBe("estimado");
    expect(seatRatio?.citation.sourceDocument).toContain("IBC");
  });

  it("resolves the B-11 mercantile occupant-density ratio for colmado/ferreteria/minimarket", async () => {
    const businessTypes = await listBusinessTypes();
    for (const slug of ["colmado", "ferreteria", "minimarket"]) {
      const businessType = businessTypes.find((bt) => bt.slug === slug);
      const ratio = businessType?.parameters.find(
        (p) => p.parameterTableSlug === "capacity_m2_por_ocupante_minorista",
      );
      expect(ratio, `expected a ratio for ${slug}`).toBeDefined();
      expect(ratio?.valueBase).toBeCloseTo(5.57, 2);
    }
  });

  it("does not fabricate a capacity ratio for salon (deliberately left uncovered — see the B-11 migration)", async () => {
    const businessTypes = await listBusinessTypes();
    const salon = businessTypes.find((bt) => bt.slug === "salon");
    expect(salon).toBeDefined();
    expect(salon?.parameters).toHaveLength(0);
  });

  it("exposes a numeric id per business type (Step 4: needed for POST /projects)", async () => {
    const businessTypes = await listBusinessTypes();
    for (const bt of businessTypes) {
      expect(Number.isInteger(bt.id)).toBe(true);
    }
    expect(new Set(businessTypes.map((bt) => bt.id)).size).toBe(businessTypes.length);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("GET /jurisdictions (DB-backed)", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await closePool();
  });

  it("lists exactly the 3 seeded MVP launch metro areas, each with a numeric id", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [CatalogModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const res = await request(app.getHttpServer()).get("/jurisdictions");
    expect(res.status).toBe(200);
    const jurisdictions = res.body as JurisdictionBody[];
    expect(jurisdictions.map((j) => j.slug).sort()).toEqual([
      "distrito-nacional",
      "santiago",
      "santo-domingo",
    ]);
    for (const j of jurisdictions) {
      expect(Number.isInteger(j.id)).toBe(true);
      expect(j.nameEs.length).toBeGreaterThan(0);
    }
  });
});
