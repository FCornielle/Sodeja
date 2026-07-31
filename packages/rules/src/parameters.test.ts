import { describe, expect, it } from "vitest";
import { resolveParameterValue } from "./parameters.js";
import type { BusinessType, CitationRow, Jurisdiction, ParameterTable, ParameterValue } from "./types.js";

const nacional: Jurisdiction = { id: 1, parentId: null, level: "nacional", slug: "nacional", name: "RD" };
const santiago: Jurisdiction = { id: 2, parentId: 1, level: "provincia", slug: "santiago", name: "Santiago" };
const chain = [santiago, nacional];

const table: ParameterTable = {
  id: 10,
  slug: "tss_ceiling_base",
  nameEs: "Tope TSS — Base",
  unit: "DOP",
  domain: "labor",
};

const restaurante: BusinessType = {
  id: 5,
  slug: "restaurante",
  nameEs: "Restaurante",
  descriptionEs: null,
  isActive: true,
  displayOrder: 1,
};

const citation: CitationRow = {
  id: 200,
  sourceName: "TSS",
  documentTitle: "Ley 87-01",
  articleRef: null,
  sourceUrl: null,
  publishedOn: null,
  retrievedOn: "2026-07-25",
  isVerified: true,
  verificationNote: null,
};
const citationsById = new Map([[200, citation]]);

function value(overrides: Partial<ParameterValue>): ParameterValue {
  return {
    id: 1,
    parameterTableId: table.id,
    businessTypeId: null,
    jurisdictionId: null,
    valueLow: 23223,
    valueBase: 23223,
    valueHigh: 23223,
    currency: "DOP",
    validFrom: "2026-02-01",
    validTo: null,
    citationId: 200,
    provenance: "referencia_sectorial",
    ...overrides,
  };
}

describe("resolveParameterValue", () => {
  it("resolves a nationally-applicable, business-type-agnostic value", () => {
    const result = resolveParameterValue({
      parameterTable: table,
      parameterValues: [value({})],
      citationsById,
      asOfDate: "2026-07-31",
    });
    expect(result?.valueBase).toBe(23223);
    expect(result?.currency).toBe("DOP");
    expect(result?.citation.sourceDocument).toBe("Ley 87-01");
    expect(result?.provenance).toBe("referencia_sectorial");
  });

  it("returns null when nothing is in force as of the given date", () => {
    const result = resolveParameterValue({
      parameterTable: table,
      parameterValues: [value({ validFrom: "2099-01-01" })],
      citationsById,
      asOfDate: "2026-07-31",
    });
    expect(result).toBeNull();
  });

  it("prefers a business-type-specific value over the applies-to-all default", () => {
    const generic = value({ id: 1, valueBase: 100, valueLow: 100, valueHigh: 100 });
    const specific = value({
      id: 2,
      businessTypeId: restaurante.id,
      valueBase: 200,
      valueLow: 200,
      valueHigh: 200,
    });
    const result = resolveParameterValue({
      parameterTable: table,
      parameterValues: [generic, specific],
      citationsById,
      asOfDate: "2026-07-31",
      businessType: restaurante,
    });
    expect(result?.valueBase).toBe(200);
    expect(result?.businessTypeSlug).toBe("restaurante");
  });

  it("prefers the most specific jurisdiction in the chain over an applies-to-all value", () => {
    const national = value({ id: 1, valueBase: 100, valueLow: 100, valueHigh: 100 });
    const local = value({
      id: 2,
      jurisdictionId: santiago.id,
      valueBase: 150,
      valueLow: 150,
      valueHigh: 150,
    });
    const result = resolveParameterValue({
      parameterTable: table,
      parameterValues: [national, local],
      citationsById,
      asOfDate: "2026-07-31",
      jurisdictionChain: chain,
    });
    expect(result?.valueBase).toBe(150);
    expect(result?.jurisdictionSlug).toBe("santiago");
  });

  it("ignores a value tied to a business type other than the one requested", () => {
    const other: BusinessType = { ...restaurante, id: 6, slug: "colmado" };
    const forOther = value({ businessTypeId: other.id });
    const result = resolveParameterValue({
      parameterTable: table,
      parameterValues: [forOther],
      citationsById,
      asOfDate: "2026-07-31",
      businessType: restaurante,
    });
    expect(result).toBeNull();
  });

  it("never returns a low bound above base or base above high", () => {
    const result = resolveParameterValue({
      parameterTable: table,
      parameterValues: [value({ valueLow: 90000, valueBase: 92892, valueHigh: 95000 })],
      citationsById,
      asOfDate: "2026-07-31",
    });
    expect(result).not.toBeNull();
    if (result) {
      expect(result.valueLow).toBeLessThanOrEqual(result.valueBase);
      expect(result.valueBase).toBeLessThanOrEqual(result.valueHigh);
    }
  });
});
