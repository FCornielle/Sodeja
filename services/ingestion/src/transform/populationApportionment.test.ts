import { describe, expect, it } from "vitest";
import { apportionPopulation } from "./populationApportionment.js";

describe("apportionPopulation", () => {
  it("splits population proportionally to the cell's share of the admin area", () => {
    // A cell that is exactly 1/1000th of its admin area's total land area
    // should get 1/1000th of that admin area's population.
    expect(apportionPopulation(1_000, 1_000_000, 1_000_000)).toBe(1_000);
    // 100,000 * (10,000 / 10,000,000) = 100,000 * 0.001 = 100
    expect(apportionPopulation(10_000, 100_000, 10_000_000)).toBe(100);
  });

  it("returns 0 (an honest zero, not a fabricated figure) when no census data covers the cell", () => {
    expect(apportionPopulation(62_500, null, null)).toBe(0);
    expect(apportionPopulation(62_500, 50_000, null)).toBe(0);
    expect(apportionPopulation(62_500, null, 1_000_000)).toBe(0);
  });

  it("never divides by a non-positive admin area", () => {
    expect(apportionPopulation(62_500, 50_000, 0)).toBe(0);
    expect(apportionPopulation(62_500, 50_000, -100)).toBe(0);
  });

  it("rounds to the nearest whole person", () => {
    expect(apportionPopulation(1, 3, 2)).toBe(2); // 3 * (1/2) = 1.5 -> rounds to 2
  });

  it("never returns a negative population", () => {
    expect(apportionPopulation(0, 100, 1_000)).toBe(0);
  });
});
