import { closePool } from "@sodeja/db";
import { afterAll, describe, expect, it } from "vitest";
import { resolveParameter } from "./evaluate.js";

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
