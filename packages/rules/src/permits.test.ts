import { describe, expect, it } from "vitest";
import { evaluatePermitRules } from "./permits.js";
import type { CitationRow, Jurisdiction, Rule, RulePack } from "./types.js";

const nacional: Jurisdiction = {
  id: 1,
  parentId: null,
  level: "nacional",
  slug: "nacional",
  name: "República Dominicana",
};
const santiago: Jurisdiction = {
  id: 2,
  parentId: 1,
  level: "provincia",
  slug: "santiago",
  name: "Santiago",
};
const chain = [santiago, nacional];

const citation: CitationRow = {
  id: 100,
  sourceName: "MOPC",
  documentTitle: "Reglamento de prueba",
  articleRef: null,
  sourceUrl: null,
  publishedOn: "2026-01-01",
  retrievedOn: "2026-07-25",
  isVerified: true,
  verificationNote: null,
};
const citationsById = new Map([[100, citation]]);

function pack(overrides: Partial<RulePack>): RulePack {
  return {
    id: 1,
    jurisdictionId: nacional.id,
    domain: "permits",
    version: 1,
    status: "published",
    validFrom: "2026-01-01",
    validTo: null,
    ...overrides,
  };
}

function rule(overrides: Partial<Rule>): Rule {
  return {
    id: 1,
    rulePackId: 1,
    code: "uso-suelo",
    titleEs: "Certificado de uso de suelo",
    descriptionEs: null,
    condition: true,
    consequence: {},
    requirement: "required",
    agencyName: "Ayuntamiento",
    citationId: 100,
    displayOrder: 0,
    ...overrides,
  };
}

describe("evaluatePermitRules", () => {
  it("returns a result with citation and effective date for a matched rule", () => {
    const nationalPack = pack({ id: 1, jurisdictionId: nacional.id });
    const { results, failures } = evaluatePermitRules({
      jurisdictionChain: chain,
      rulePacks: [nationalPack],
      rules: [rule({ rulePackId: 1 })],
      citationsById,
      asOfDate: "2026-07-31",
      facts: {},
    });
    expect(failures).toEqual([]);
    expect(results).toHaveLength(1);
    expect(results[0]?.requirement).toBe("required");
    expect(results[0]?.citation.sourceDocument).toBe("Reglamento de prueba");
    expect(results[0]?.effectiveFrom).toBe("2026-01-01");
  });

  it("never returns a 'compliant' verdict — only the four documented requirement values", () => {
    const nationalPack = pack({ id: 1, jurisdictionId: nacional.id });
    const { results } = evaluatePermitRules({
      jurisdictionChain: chain,
      rulePacks: [nationalPack],
      rules: [rule({ rulePackId: 1, requirement: "not_applicable" })],
      citationsById,
      asOfDate: "2026-07-31",
      facts: {},
    });
    const allowed = ["required", "likely_required", "not_applicable", "unknown"];
    for (const r of results) expect(allowed).toContain(r.requirement);
  });

  it("treats a null requirement column as 'unknown' rather than crashing", () => {
    const nationalPack = pack({ id: 1, jurisdictionId: nacional.id });
    const { results } = evaluatePermitRules({
      jurisdictionChain: chain,
      rulePacks: [nationalPack],
      rules: [rule({ rulePackId: 1, requirement: null })],
      citationsById,
      asOfDate: "2026-07-31",
      facts: {},
    });
    expect(results[0]?.requirement).toBe("unknown");
  });

  it("lets a municipal/provincial rule override a national rule sharing the same code", () => {
    const nationalPack = pack({ id: 1, jurisdictionId: nacional.id });
    const santiagoPack = pack({ id: 2, jurisdictionId: santiago.id });
    const { results } = evaluatePermitRules({
      jurisdictionChain: chain,
      rulePacks: [nationalPack, santiagoPack],
      rules: [
        rule({ id: 1, rulePackId: 1, code: "uso-suelo", requirement: "required", titleEs: "Nacional" }),
        rule({ id: 2, rulePackId: 2, code: "uso-suelo", requirement: "not_applicable", titleEs: "Santiago" }),
      ],
      citationsById,
      asOfDate: "2026-07-31",
      facts: {},
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.titleEs).toBe("Santiago");
    expect(results[0]?.requirement).toBe("not_applicable");
  });

  it("excludes a rule pack that is not yet in force", () => {
    const futurePack = pack({ id: 1, jurisdictionId: nacional.id, validFrom: "2099-01-01" });
    const { results } = evaluatePermitRules({
      jurisdictionChain: chain,
      rulePacks: [futurePack],
      rules: [rule({ rulePackId: 1 })],
      citationsById,
      asOfDate: "2026-07-31",
      facts: {},
    });
    expect(results).toEqual([]);
  });

  it("excludes a draft (unpublished) rule pack", () => {
    const draftPack = pack({ id: 1, jurisdictionId: nacional.id, status: "draft" });
    const { results } = evaluatePermitRules({
      jurisdictionChain: chain,
      rulePacks: [draftPack],
      rules: [rule({ rulePackId: 1 })],
      citationsById,
      asOfDate: "2026-07-31",
      facts: {},
    });
    expect(results).toEqual([]);
  });

  it("isolates a malformed condition into failures instead of throwing", () => {
    const nationalPack = pack({ id: 1, jurisdictionId: nacional.id });
    let deeplyNested: unknown = { var: "leaf" };
    for (let i = 0; i < 50; i++) deeplyNested = { and: [deeplyNested] };
    const { results, failures } = evaluatePermitRules({
      jurisdictionChain: chain,
      rulePacks: [nationalPack],
      rules: [rule({ rulePackId: 1, condition: deeplyNested })],
      citationsById,
      asOfDate: "2026-07-31",
      facts: {},
    });
    expect(results).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.ruleCode).toBe("uso-suelo");
  });

  it("isolates a rule whose citation is missing rather than returning it uncited", () => {
    const nationalPack = pack({ id: 1, jurisdictionId: nacional.id });
    const { results, failures } = evaluatePermitRules({
      jurisdictionChain: chain,
      rulePacks: [nationalPack],
      rules: [rule({ rulePackId: 1, citationId: 999 })],
      citationsById,
      asOfDate: "2026-07-31",
      facts: {},
    });
    expect(results).toEqual([]);
    expect(failures[0]?.message).toContain("999");
  });

  it("does not include a rule whose condition evaluates false", () => {
    const nationalPack = pack({ id: 1, jurisdictionId: nacional.id });
    const { results } = evaluatePermitRules({
      jurisdictionChain: chain,
      rulePacks: [nationalPack],
      rules: [rule({ rulePackId: 1, condition: { ">": [{ var: "areaSqm" }, 1000] } })],
      citationsById,
      asOfDate: "2026-07-31",
      facts: { areaSqm: 50 },
    });
    expect(results).toEqual([]);
  });
});
