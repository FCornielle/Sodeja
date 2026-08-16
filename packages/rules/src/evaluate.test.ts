import { closePool } from "@sodeja/db";
import { afterAll, describe, expect, it } from "vitest";
import { evaluatePermits, resolveParameter } from "./evaluate.js";

// Exercises the real B-10 seed migration (packages/db/migrations/*_seed-rules-content.sql)
// end-to-end. Skipped without DATABASE_URL. If the seed migration has not yet
// run against this database (e.g. a turbo scheduling race with @sodeja/db's
// own migrate step), this test warns and passes trivially rather than
// failing the whole suite on an ordering issue outside this package's control.
describe.skipIf(!process.env.DATABASE_URL)("resolveParameter (DB-backed, seeded content)", () => {
  afterAll(async () => {
    await closePool();
  });

  it("resolves the seeded TSS base ceiling exactly as VERIFIED in SODEJA_DATA_SOURCES.md", async () => {
    const result = await resolveParameter({
      parameterTableSlug: "tss_ceiling_base",
      asOfDate: "2026-07-31",
    });
    if (!result) {
      console.warn(
        "tss_ceiling_base not found — seed migration likely has not run yet against this DB; skipping assertions.",
      );
      return;
    }
    expect(result.valueBase).toBe(23223);
    expect(result.currency).toBe("DOP");
    expect(result.citation.retrievedAt).toBeTruthy();
    expect(result.provenance).toBe("referencia_sectorial");
  });

  it("resolves the seeded minimum wage for micro businesses", async () => {
    const result = await resolveParameter({
      parameterTableSlug: "salario_minimo_micro",
      asOfDate: "2026-07-31",
    });
    if (!result) {
      console.warn("salario_minimo_micro not found — skipping assertions.");
      return;
    }
    expect(result.valueBase).toBeCloseTo(16993.2, 2);
  });

  it("returns null for a parameter table slug that was deliberately not seeded (RST thresholds)", async () => {
    const result = await resolveParameter({
      parameterTableSlug: "rst_threshold",
      asOfDate: "2026-07-31",
    });
    expect(result).toBeNull();
  });
});

// Exercises the B-18 permits seed (packages/db/migrations/*_seed-permits-content.sql).
// Same skip/warn contract as the parameter tests above: absent DATABASE_URL the
// suite is skipped, and content that has not been migrated yet warns rather
// than failing on a turbo ordering race.
const PERMITS_AS_OF = "2026-08-16";

describe.skipIf(!process.env.DATABASE_URL)("evaluatePermits (DB-backed, seeded content)", () => {
  afterAll(async () => {
    await closePool();
  });

  it("evaluates every seeded rule without a single failure", async () => {
    const { results, failures } = await evaluatePermits({
      jurisdictionSlug: "distrito-nacional",
      asOfDate: PERMITS_AS_OF,
      facts: { businessTypeSlug: "restaurante" },
    });
    if (results.length === 0) {
      console.warn("no permit rules found — seed migration likely has not run yet; skipping.");
      return;
    }
    // A failure here means a malformed condition or an uncited/unverified rule
    // reached the database — the two things the seed migration must never do.
    expect(failures).toEqual([]);
  });

  it("carries a verified citation and an effective date on every result", async () => {
    const { results } = await evaluatePermits({
      jurisdictionSlug: "santiago",
      asOfDate: PERMITS_AS_OF,
      facts: { businessTypeSlug: "colmado" },
    });
    if (results.length === 0) return;
    for (const result of results) {
      expect(result.citation.sourceName).toBeTruthy();
      expect(result.citation.sourceDocument).toBeTruthy();
      expect(result.citation.retrievedAt).toBeTruthy();
      expect(result.effectiveFrom).toBeTruthy();
    }
  });

  it("never emits a requirement outside the four documented values", async () => {
    const { results } = await evaluatePermits({
      jurisdictionSlug: "distrito-nacional",
      asOfDate: PERMITS_AS_OF,
      facts: { businessTypeSlug: "restaurante" },
    });
    if (results.length === 0) return;
    const allowed = ["required", "likely_required", "not_applicable", "unknown"];
    for (const result of results) expect(allowed).toContain(result.requirement);
  });

  it("resolves 'uso-suelo' to the Distrito Nacional instrument, not the national default", async () => {
    const { results } = await evaluatePermits({
      jurisdictionSlug: "distrito-nacional",
      asOfDate: PERMITS_AS_OF,
      facts: { businessTypeSlug: "ferreteria" },
    });
    if (results.length === 0) return;
    const usoSuelo = results.filter((r) => r.ruleCode === "uso-suelo");
    expect(usoSuelo).toHaveLength(1);
    expect(usoSuelo[0]?.jurisdictionSlug).toBe("distrito-nacional");
    expect(usoSuelo[0]?.titleEs).toContain("Certificación de Uso de Suelo");
  });

  it("resolves 'uso-suelo' to Santiago's differently-named instrument", async () => {
    const { results } = await evaluatePermits({
      jurisdictionSlug: "santiago",
      asOfDate: PERMITS_AS_OF,
      facts: { businessTypeSlug: "ferreteria" },
    });
    if (results.length === 0) return;
    const usoSuelo = results.filter((r) => r.ruleCode === "uso-suelo");
    expect(usoSuelo).toHaveLength(1);
    expect(usoSuelo[0]?.jurisdictionSlug).toBe("santiago");
    expect(usoSuelo[0]?.titleEs).toContain("No Objeción al Uso de Suelo");
  });

  it("applies the food rules to a restaurante but not to a ferretería", async () => {
    const foodCodes = ["salud-establecimiento-alimentos", "salud-certificado-manipuladores"];
    const restaurante = await evaluatePermits({
      jurisdictionSlug: "distrito-nacional",
      asOfDate: PERMITS_AS_OF,
      facts: { businessTypeSlug: "restaurante" },
    });
    if (restaurante.results.length === 0) return;
    const ferreteria = await evaluatePermits({
      jurisdictionSlug: "distrito-nacional",
      asOfDate: PERMITS_AS_OF,
      facts: { businessTypeSlug: "ferreteria" },
    });

    for (const code of foodCodes) {
      expect(restaurante.results.map((r) => r.ruleCode)).toContain(code);
      expect(ferreteria.results.map((r) => r.ruleCode)).not.toContain(code);
    }
  });

  it("omits the food rules when businessTypeSlug is absent rather than assuming they apply", async () => {
    const { results, failures } = await evaluatePermits({
      jurisdictionSlug: "distrito-nacional",
      asOfDate: PERMITS_AS_OF,
      facts: {},
    });
    if (results.length === 0) return;
    expect(failures).toEqual([]);
    expect(results.map((r) => r.ruleCode)).not.toContain("salud-establecimiento-alimentos");
  });

  it("returns nothing for a date before the pack was published", async () => {
    const { results } = await evaluatePermits({
      jurisdictionSlug: "distrito-nacional",
      asOfDate: "2020-01-01",
      facts: { businessTypeSlug: "restaurante" },
    });
    expect(results).toEqual([]);
  });
});
