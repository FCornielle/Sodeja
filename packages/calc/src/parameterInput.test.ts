import type { ResolvedParameter } from "@sodeja/schemas";
import { describe, expect, it } from "vitest";
import { parameterToMoneyRange, parameterToNumericRange, UnitlessParameterError } from "./parameterInput.js";

const tssBase: ResolvedParameter = {
  parameterTableSlug: "tss_ceiling_base",
  valueLow: 23223,
  valueBase: 23223,
  valueHigh: 23223,
  currency: "DOP",
  citation: {
    sourceDocument: "Ley 87-01 — Sistema Dominicano de Seguridad Social",
    retrievedAt: "2026-07-25T00:00:00.000Z",
  },
  provenance: "referencia_sectorial",
  validFrom: "2026-02-01T00:00:00.000Z",
};

const capacityRatio: ResolvedParameter = {
  ...tssBase,
  parameterTableSlug: "capacity_ratio_restaurante",
  currency: null,
  valueLow: 1.2,
  valueBase: 1.5,
  valueHigh: 1.8,
};

describe("parameterToMoneyRange", () => {
  it("converts a currency-bearing ResolvedParameter directly into a Range<Money>", () => {
    const range = parameterToMoneyRange(tssBase);
    expect(range).toEqual({
      pessimistic: { amount: 23223, currency: "DOP" },
      base: { amount: 23223, currency: "DOP" },
      optimistic: { amount: 23223, currency: "DOP" },
    });
  });

  it("refuses a unitless parameter", () => {
    expect(() => parameterToMoneyRange(capacityRatio)).toThrow(UnitlessParameterError);
  });
});

describe("parameterToNumericRange", () => {
  it("converts a unitless ResolvedParameter into a plain Range<number>", () => {
    expect(parameterToNumericRange(capacityRatio)).toEqual({
      pessimistic: 1.2,
      base: 1.5,
      optimistic: 1.8,
    });
  });

  it("also works for a currency-bearing parameter when only the magnitude matters", () => {
    expect(parameterToNumericRange(tssBase)).toEqual({ pessimistic: 23223, base: 23223, optimistic: 23223 });
  });
});
