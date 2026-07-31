import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type OvertureRawPlace,
  mapOverturePlaceRow,
  mapOvertureCategory,
  normalizeConfidence,
  overtureReleaseToVintage,
} from "./poiPlaceRow.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

function loadFixture(): OvertureRawPlace[] {
  const content = readFileSync(join(FIXTURES_DIR, "overture-places-sample.ndjson"), "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as OvertureRawPlace);
}

describe("mapOvertureCategory", () => {
  it("maps restaurant subtypes (exact and _restaurant suffix) to restaurante", () => {
    expect(mapOvertureCategory("restaurant")).toBe("restaurante");
    expect(mapOvertureCategory("dominican_restaurant")).toBe("restaurante");
    expect(mapOvertureCategory("fast_food_restaurant")).toBe("restaurante");
  });

  it("maps convenience_store to colmado", () => {
    expect(mapOvertureCategory("convenience_store")).toBe("colmado");
  });

  it("maps grocery_store to minimarket, but not supermarket (different format)", () => {
    expect(mapOvertureCategory("grocery_store")).toBe("minimarket");
    expect(mapOvertureCategory("supermarket")).toBeNull();
  });

  it("maps hardware_store to ferreteria, but not computer_hardware_company", () => {
    expect(mapOvertureCategory("hardware_store")).toBe("ferreteria");
    expect(mapOvertureCategory("computer_hardware_company")).toBeNull();
  });

  it("maps _salon suffix categories to salon, but not adjacent beauty/hair categories", () => {
    expect(mapOvertureCategory("beauty_salon")).toBe("salon");
    expect(mapOvertureCategory("hair_salon")).toBe("salon");
    expect(mapOvertureCategory("nail_salon")).toBe("salon");
    expect(mapOvertureCategory("beauty_and_spa")).toBeNull();
    expect(mapOvertureCategory("hair_supply_stores")).toBeNull();
  });

  it("returns null for unrelated categories and for null/undefined input", () => {
    expect(mapOvertureCategory("church_cathedral")).toBeNull();
    expect(mapOvertureCategory("landmark_and_historical_building")).toBeNull();
    expect(mapOvertureCategory(null)).toBeNull();
    expect(mapOvertureCategory(undefined)).toBeNull();
  });
});

describe("normalizeConfidence", () => {
  it("passes through values within [0, 1]", () => {
    expect(normalizeConfidence(0)).toBe(0);
    expect(normalizeConfidence(0.5)).toBe(0.5);
    expect(normalizeConfidence(1)).toBe(1);
  });

  it("normalizes out-of-range or missing values to null", () => {
    expect(normalizeConfidence(-1)).toBeNull();
    expect(normalizeConfidence(1.5)).toBeNull();
    expect(normalizeConfidence(null)).toBeNull();
    expect(normalizeConfidence(undefined)).toBeNull();
    expect(normalizeConfidence(Number.NaN)).toBeNull();
  });
});

describe("overtureReleaseToVintage", () => {
  it("extracts the date portion of a release tag", () => {
    expect(overtureReleaseToVintage("2026-07-22.0")).toBe("2026-07-22");
  });

  it("throws for an unparseable release tag", () => {
    expect(() => overtureReleaseToVintage("latest")).toThrow();
  });
});

describe("mapOverturePlaceRow", () => {
  it("maps a raw Overture row into a PoiPlaceRow, retaining raw_category even when category is null", () => {
    const raw: OvertureRawPlace = {
      id: "abc-123",
      name: "Colmado Doña Ana",
      category: "convenience_store",
      confidence: 0.75,
      lon: -69.9,
      lat: 18.48,
    };
    const row = mapOverturePlaceRow(raw, "2026-07-22");
    expect(row).toEqual({
      externalId: "abc-123",
      name: "Colmado Doña Ana",
      category: "colmado",
      rawCategory: "convenience_store",
      confidence: 0.75,
      geometry: { type: "Point", coordinates: [-69.9, 18.48] },
      source: "overture",
      sourceLicense: expect.stringContaining("Mixed"),
      sourceVintage: "2026-07-22",
    });
  });

  it("keeps rawCategory and a null category for unmapped categories (never drops the original)", () => {
    const raw: OvertureRawPlace = {
      id: "xyz-999",
      name: "Iglesia Casa del Rey Jesus",
      category: "church_cathedral",
      confidence: 0.98,
      lon: -69.97,
      lat: 18.45,
    };
    const row = mapOverturePlaceRow(raw, "2026-07-22");
    expect(row.category).toBeNull();
    expect(row.rawCategory).toBe("church_cathedral");
    expect(row.confidence).toBe(0.98); // low/high confidence is stored either way, never filtered here
  });

  it("throws if the row has no id", () => {
    const raw = { id: "", name: null, category: null, confidence: null, lon: 0, lat: 0 } as OvertureRawPlace;
    expect(() => mapOverturePlaceRow(raw, "2026-07-22")).toThrow();
  });
});

describe("real fixture (overture-places-sample.ndjson)", () => {
  const rows = loadFixture();

  it("has real Overture DR rows spanning mapped and unmapped categories, including nulls", () => {
    expect(rows.length).toBeGreaterThan(30);
    const categories = new Set(rows.map((r) => r.category));
    expect(categories.has("restaurant")).toBe(true);
    expect(categories.has("church_cathedral")).toBe(true); // deliberately unmapped
    expect(rows.some((r) => r.category === null)).toBe(true);
  });

  it("maps every fixture row without throwing, and never silently drops confidence or rawCategory", () => {
    const mapped = rows.map((r) => mapOverturePlaceRow(r, "2026-07-22"));
    expect(mapped).toHaveLength(rows.length);
    for (let i = 0; i < mapped.length; i++) {
      expect(mapped[i]!.rawCategory).toBe(rows[i]!.category);
      expect(mapped[i]!.confidence).toBe(rows[i]!.confidence);
    }
    // At least one row per curated business type should be present, proving
    // the mapping rule actually fires on real data, not just synthetic cases.
    const mappedSlugs = new Set(mapped.map((r) => r.category).filter(Boolean));
    expect(mappedSlugs).toEqual(new Set(["restaurante", "colmado", "minimarket", "ferreteria", "salon"]));
  });
});
