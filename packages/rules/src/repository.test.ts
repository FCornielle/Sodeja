import { closePool, withServiceSession } from "@sodeja/db";
import { afterAll, describe, expect, it } from "vitest";
import {
  fetchBusinessTypeBySlug,
  fetchCitationsByIds,
  fetchJurisdictions,
  fetchParameterTableBySlug,
  fetchParameterValues,
} from "./repository.js";

// Integration tests against a real Postgres — see packages/db's schema.test.ts
// for the same pattern. Skipped (not failed) without DATABASE_URL so this
// package's test suite still passes cleanly in an environment with no DB
// (e.g. a local dev machine without Docker running).
describe.skipIf(!process.env.DATABASE_URL)("repository (DB-backed)", () => {
  afterAll(async () => {
    await closePool();
  });

  it("fetches the seeded jurisdiction catalog", async () => {
    const jurisdictions = await withServiceSession(fetchJurisdictions);
    const slugs = jurisdictions.map((j) => j.slug);
    expect(slugs).toContain("nacional");
  });

  it("returns null for a business type slug that does not exist", async () => {
    const result = await withServiceSession((client) =>
      fetchBusinessTypeBySlug(client, `no-such-sector-${crypto.randomUUID()}`),
    );
    expect(result).toBeNull();
  });

  it("round-trips a freshly-inserted parameter_table/parameter_value/citation", async () => {
    const slug = `test_param_${crypto.randomUUID().replace(/-/g, "")}`;
    const { parameterTableId, citationId } = await withServiceSession(async (client) => {
      const table = await client.query<{ id: number }>(
        "INSERT INTO content.parameter_table (slug, name_es, unit, domain) VALUES ($1, 'Prueba', 'DOP', 'labor') RETURNING id",
        [slug],
      );
      const citation = await client.query<{ id: number }>(
        `INSERT INTO content.citation (source_name, document_title, retrieved_on, is_verified)
         VALUES ('Test', 'Test doc', CURRENT_DATE, true) RETURNING id`,
      );
      const parameterTableId = table.rows[0]?.id;
      const citationId = citation.rows[0]?.id;
      if (!parameterTableId || !citationId) throw new Error("setup insert returned no id");
      await client.query(
        `INSERT INTO content.parameter_value
           (parameter_table_id, value_low, value_base, value_high, currency, valid_from, citation_id, provenance)
         VALUES ($1, 100, 100, 100, 'DOP', '2026-01-01', $2, 'referencia_sectorial')`,
        [parameterTableId, citationId],
      );
      return { parameterTableId, citationId };
    });

    const fetchedTable = await withServiceSession((client) => fetchParameterTableBySlug(client, slug));
    expect(fetchedTable?.id).toBe(parameterTableId);

    const values = await withServiceSession((client) =>
      fetchParameterValues(client, parameterTableId),
    );
    expect(values).toHaveLength(1);
    expect(values[0]?.valueBase).toBe(100);

    const citationsById = await withServiceSession((client) =>
      fetchCitationsByIds(client, [citationId]),
    );
    expect(citationsById.get(citationId)?.isVerified).toBe(true);
  });
});
