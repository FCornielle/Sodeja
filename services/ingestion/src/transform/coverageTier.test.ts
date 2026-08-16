import { describe, expect, it } from "vitest";
import {
  computeCoverageCell,
  FOOTPRINT_REFERENCE_COUNT,
  POI_REFERENCE_WEIGHT,
  scoreFootprintDensity,
  scorePoiDensity,
  TIER_THRESHOLD_ALTA,
  TIER_THRESHOLD_BAJA,
  TIER_THRESHOLD_MEDIA,
} from "./coverageTier.js";

describe("scoreFootprintDensity", () => {
  it("is 0 for an empty cell", () => {
    expect(scoreFootprintDensity(0)).toBe(0);
  });

  it("scales linearly up to the reference count", () => {
    expect(scoreFootprintDensity(FOOTPRINT_REFERENCE_COUNT / 2)).toBeCloseTo(0.5);
  });

  it("clamps at 1 beyond the reference count", () => {
    expect(scoreFootprintDensity(FOOTPRINT_REFERENCE_COUNT * 10)).toBe(1);
  });

  it("never returns a negative score for a negative count", () => {
    expect(scoreFootprintDensity(-5)).toBe(0);
  });
});

describe("scorePoiDensity", () => {
  it("is 0 for a cell with no POIs", () => {
    expect(scorePoiDensity(0)).toBe(0);
  });

  it("scales linearly up to the reference weight", () => {
    expect(scorePoiDensity(POI_REFERENCE_WEIGHT / 2)).toBeCloseTo(0.5);
  });

  it("clamps at 1 beyond the reference weight", () => {
    expect(scorePoiDensity(POI_REFERENCE_WEIGHT * 10)).toBe(1);
  });
});

describe("computeCoverageCell", () => {
  it("produces 'insuficiente' for an entirely empty cell (empty database, risk D3's mechanism working as designed)", () => {
    const result = computeCoverageCell(0, 0, 0);
    expect(result.footprintScore).toBe(0);
    expect(result.poiScore).toBe(0);
    expect(result.censusScore).toBe(0);
    expect(result.composite).toBe(0);
    expect(result.tier).toBe("insuficiente");
  });

  it("produces 'alta' when all three signals are strong", () => {
    const result = computeCoverageCell(FOOTPRINT_REFERENCE_COUNT, POI_REFERENCE_WEIGHT, 1);
    expect(result.composite).toBe(1);
    expect(result.tier).toBe("alta");
  });

  it("respects the documented threshold boundaries (>= lands in the higher tier, just below lands in the lower one)", () => {
    // composite = (footprintScore + poiScore + censusScore) / 3. censusScore
    // is binary (0 or 1), so hitting 0.45/0.7 exactly requires combining a
    // fractional footprint/poi score with censusScore=1 (footprintScore
    // alone maxes at 1, i.e. composite <= 1/3, which cannot reach 0.45/0.7).

    // baja threshold (0.20): reachable via footprintScore alone (0.20*3=0.6 <= 1).
    const justBelowBaja = computeCoverageCell(FOOTPRINT_REFERENCE_COUNT * (TIER_THRESHOLD_BAJA * 3) - 1, 0, 0);
    const atBaja = computeCoverageCell(FOOTPRINT_REFERENCE_COUNT * (TIER_THRESHOLD_BAJA * 3), 0, 0);
    expect(justBelowBaja.composite).toBeLessThan(TIER_THRESHOLD_BAJA);
    expect(justBelowBaja.tier).toBe("insuficiente");
    expect(atBaja.composite).toBeCloseTo(TIER_THRESHOLD_BAJA);
    expect(atBaja.tier).toBe("baja");

    // media threshold (0.45): censusScore=1, poiScore=0,
    // footprintScore = 0.45*3 - 1 = 0.35.
    const justBelowMedia = computeCoverageCell(FOOTPRINT_REFERENCE_COUNT * 0.35 - 0.1, 0, 1);
    const atMedia = computeCoverageCell(FOOTPRINT_REFERENCE_COUNT * 0.35, 0, 1);
    expect(justBelowMedia.composite).toBeLessThan(TIER_THRESHOLD_MEDIA);
    expect(justBelowMedia.tier).toBe("baja");
    expect(atMedia.composite).toBeCloseTo(TIER_THRESHOLD_MEDIA);
    expect(atMedia.tier).toBe("media");

    // alta threshold (0.70): footprintScore=1, censusScore=1,
    // poiScore = 0.70*3 - 1 - 1 = 0.10.
    const justBelowAlta = computeCoverageCell(FOOTPRINT_REFERENCE_COUNT, POI_REFERENCE_WEIGHT * 0.1 - 0.1, 1);
    const atAlta = computeCoverageCell(FOOTPRINT_REFERENCE_COUNT, POI_REFERENCE_WEIGHT * 0.1, 1);
    expect(justBelowAlta.composite).toBeLessThan(TIER_THRESHOLD_ALTA);
    expect(justBelowAlta.tier).toBe("media");
    expect(atAlta.composite).toBeCloseTo(TIER_THRESHOLD_ALTA);
    expect(atAlta.tier).toBe("alta");
  });

  it("a cell with real census data but zero footprints/POIs lands below alta, at most media", () => {
    const result = computeCoverageCell(0, 0, 1);
    expect(result.composite).toBeCloseTo(1 / 3);
    expect(result.tier).toBe("baja");
  });
});
