import { describe, expect, it } from "vitest";
import {
  CitationSchema,
  DataConfidenceSchema,
  MoneyRangeSchema,
  MoneySchema,
  NumericRangeSchema,
  ProvenanceSchema,
} from "./primitives.js";

describe("MoneySchema", () => {
  it("accepts a finite amount with a known currency", () => {
    expect(MoneySchema.safeParse({ amount: 1500, currency: "DOP" }).success).toBe(true);
  });

  it("rejects an unknown currency", () => {
    expect(MoneySchema.safeParse({ amount: 1500, currency: "EUR" }).success).toBe(false);
  });
});

describe("MoneyRangeSchema", () => {
  const valid = {
    pessimistic: { amount: 100, currency: "DOP" },
    base: { amount: 200, currency: "DOP" },
    optimistic: { amount: 300, currency: "DOP" },
  };

  it("accepts an ordered range in a single currency", () => {
    expect(MoneyRangeSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a pessimistic bound above the base", () => {
    expect(
      MoneyRangeSchema.safeParse({ ...valid, pessimistic: { amount: 250, currency: "DOP" } }).success,
    ).toBe(false);
  });

  it("rejects mixed currencies across bounds", () => {
    expect(
      MoneyRangeSchema.safeParse({ ...valid, optimistic: { amount: 300, currency: "USD" } }).success,
    ).toBe(false);
  });
});

describe("NumericRangeSchema", () => {
  it("accepts an ordered range", () => {
    expect(NumericRangeSchema.safeParse({ pessimistic: 1, base: 2, optimistic: 3 }).success).toBe(
      true,
    );
  });

  it("rejects an out-of-order range", () => {
    expect(NumericRangeSchema.safeParse({ pessimistic: 3, base: 2, optimistic: 1 }).success).toBe(
      false,
    );
  });
});

describe("ProvenanceSchema", () => {
  it("accepts the three documented provenance tags", () => {
    for (const tag of ["usuario", "referencia_sectorial", "estimado"]) {
      expect(ProvenanceSchema.safeParse(tag).success).toBe(true);
    }
  });

  it("rejects an undocumented tag", () => {
    expect(ProvenanceSchema.safeParse("adivinado").success).toBe(false);
  });
});

describe("CitationSchema", () => {
  it("requires a source document and a retrieval date", () => {
    expect(
      CitationSchema.safeParse({
        sourceDocument: "MOPC R-007 (Decreto 284-91)",
        retrievedAt: "2026-07-25T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects a citation with no source document", () => {
    expect(
      CitationSchema.safeParse({ sourceDocument: "", retrievedAt: "2026-07-25T00:00:00.000Z" })
        .success,
    ).toBe(false);
  });
});

describe("DataConfidenceSchema", () => {
  it("accepts a score within [0, 1]", () => {
    expect(
      DataConfidenceSchema.safeParse({
        score: 0.4,
        basis: "OSM building coverage ~5.5%",
        asOfDate: "2026-07-25T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects a score outside [0, 1]", () => {
    expect(
      DataConfidenceSchema.safeParse({
        score: 1.2,
        basis: "OSM building coverage ~5.5%",
        asOfDate: "2026-07-25T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
