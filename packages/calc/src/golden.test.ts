import type { Money } from "@sodeja/schemas";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addMoneyRange, convertMoneyRange, multiplyMoneyRange } from "./money.js";
import type { Range } from "./range.js";
import { ENGINE_VERSION, snapshot } from "./version.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * A frozen scenario exercising only this package's primitives (Money/Range
 * arithmetic, FX conversion, the snapshot envelope) — deliberately NOT a
 * financial model (no capacity, fit-out, opex, or break-even logic; that is
 * B-12/14/15/17's job). Its only purpose is to pin the numeric behavior of
 * the primitive layer itself so an unintended change (a rounding tweak, a
 * combinator edge case) fails CI loudly instead of drifting silently
 * (SODEJA_RISKS.md T6; package README "Testing posture").
 */
function runFixtureScenario() {
  const rentUsd: Range<Money> = {
    pessimistic: { amount: 1200, currency: "USD" },
    base: { amount: 1500, currency: "USD" },
    optimistic: { amount: 1800, currency: "USD" },
  };
  const payrollDop: Range<Money> = {
    pessimistic: { amount: 45000, currency: "DOP" },
    base: { amount: 52000, currency: "DOP" },
    optimistic: { amount: 60000, currency: "DOP" },
  };
  const fx = { from: "USD" as const, to: "DOP" as const, rate: 60 };
  const contingencyFactor = 1.1;

  const rentDop = convertMoneyRange(rentUsd, fx);
  const totalFixedCostsDop = addMoneyRange(rentDop, payrollDop);
  const withContingency = multiplyMoneyRange(totalFixedCostsDop, contingencyFactor);

  return snapshot(
    "2026-07-31",
    { rentUsd, payrollDop, fx, contingencyFactor },
    { rentDop, totalFixedCostsDop, withContingency },
  );
}

describe(`golden regression — engine v${ENGINE_VERSION}`, () => {
  it("matches the frozen fixture exactly for this engine version", () => {
    const fixturePath = path.join(dirname, "__fixtures__", `golden-v${ENGINE_VERSION}.json`);
    const fixture: unknown = JSON.parse(readFileSync(fixturePath, "utf-8"));
    const actual: unknown = JSON.parse(JSON.stringify(runFixtureScenario()));
    expect(actual).toEqual(fixture);
  });

  it("is itself deterministic across repeated runs (no clock, no randomness)", () => {
    const first = JSON.parse(JSON.stringify(runFixtureScenario()));
    const second = JSON.parse(JSON.stringify(runFixtureScenario()));
    expect(first).toEqual(second);
  });
});
