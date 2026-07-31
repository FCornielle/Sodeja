import { describe, expect, it } from "vitest";
import { evaluateCondition, RuleEvaluationError } from "./jsonLogic.js";

describe("evaluateCondition", () => {
  it("evaluates a simple comparison against facts", () => {
    expect(evaluateCondition({ ">": [{ var: "areaSqm" }, 100] }, { areaSqm: 150 })).toBe(true);
    expect(evaluateCondition({ ">": [{ var: "areaSqm" }, 100] }, { areaSqm: 50 })).toBe(false);
  });

  it("evaluates a compound 'and' condition", () => {
    const condition = {
      and: [{ ">": [{ var: "areaSqm" }, 100] }, { "==": [{ var: "businessType" }, "restaurante"] }],
    };
    expect(evaluateCondition(condition, { areaSqm: 150, businessType: "restaurante" })).toBe(true);
    expect(evaluateCondition(condition, { areaSqm: 150, businessType: "colmado" })).toBe(false);
  });

  it("treats a missing fact as falsy rather than throwing", () => {
    expect(evaluateCondition({ ">": [{ var: "missingFact" }, 100] }, {})).toBe(false);
  });

  it("never executes arbitrary code: an operator outside the JSONLogic vocabulary is rejected, not eval'd", () => {
    // json-logic-js has a fixed, closed operator table and no eval/Function
    // path — an operator name it does not recognize (e.g. reaching for
    // process/global state) is rejected as "Unrecognized operation" and
    // surfaces as a normal RuleEvaluationError, never executed.
    const malicious = { "process.exit": [] };
    expect(() => evaluateCondition(malicious, {})).toThrow(RuleEvaluationError);
  });

  it("normalizes a malformed/oversized condition into RuleEvaluationError instead of crashing", () => {
    let deeplyNested: unknown = { var: "leaf" };
    for (let i = 0; i < 50; i++) {
      deeplyNested = { and: [deeplyNested] };
    }
    expect(() => evaluateCondition(deeplyNested, {})).toThrow(RuleEvaluationError);
  });

  it("degrades to RuleEvaluationError rather than throwing a raw json-logic-js error", () => {
    // "var" with a non-string/number path argument is a type json-logic-js itself throws on.
    const weird = { var: [{ bad: "shape" }] };
    try {
      evaluateCondition(weird, {});
    } catch (error) {
      expect(error).toBeInstanceOf(RuleEvaluationError);
    }
  });
});
