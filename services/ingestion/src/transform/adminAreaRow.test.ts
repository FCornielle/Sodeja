import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { OCHA_LICENSE, OCHA_SOURCE, mapOchaFeature } from "./adminAreaRow.js";
import type { GeoJsonFeatureCollection } from "../lib/geojson.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

function loadFixture(name: string): GeoJsonFeatureCollection {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8")) as GeoJsonFeatureCollection;
}

describe("mapOchaFeature", () => {
  it("maps ADM0 (país) with no parent", () => {
    const collection = loadFixture("ocha-admin0-sample.geojson");
    const row = mapOchaFeature(collection.features[0]!, 0, "2026-01-01");
    expect(row.level).toBe("pais");
    expect(row.code).toBe("DO");
    expect(row.parentCode).toBeNull();
    // adm0's primary `name` field is English (lang: "en"); the Spanish name
    // lives in `adm0_name1` (lang1: "es") — the field that must be picked.
    expect(row.name).toBe("República Dominicana");
    expect(row.source).toBe(OCHA_SOURCE);
    expect(row.sourceLicense).toBe(OCHA_LICENSE);
    expect(row.sourceVintage).toBe("2021-06-29"); // from valid_on
  });

  it("maps ADM2 (provincia) with parent = ADM0's pcode, skipping the ADM1 region tier", () => {
    const collection = loadFixture("ocha-admin2-sample.geojson");
    const row = mapOchaFeature(collection.features[0]!, 2, "2026-01-01");
    expect(row.level).toBe("provincia");
    expect(row.code).toBe("DO0101");
    expect(row.parentCode).toBe("DO"); // NOT "DO01" (the region) — see code comment
    expect(row.name).toBe("Provincia Duarte");
  });

  it("maps ADM3 (municipio) with parent = its ADM2 provincia", () => {
    const collection = loadFixture("ocha-admin3-sample.geojson");
    const row = mapOchaFeature(collection.features[0]!, 3, "2026-01-01");
    expect(row.level).toBe("municipio");
    expect(row.code).toBe("DO010102");
    expect(row.parentCode).toBe("DO0101");
    expect(row.name).toBe("Municipio Arenoso");
  });

  it("maps ADM4 (seccion — the closest available level) with parent = its ADM3 municipio", () => {
    const collection = loadFixture("ocha-admin4-sample.geojson");
    expect(collection.features).toHaveLength(3);

    const rows = collection.features.map((f) => mapOchaFeature(f, 4, "2026-01-01"));
    for (const row of rows) {
      expect(row.level).toBe("seccion");
      expect(row.parentCode).toBe("DO010102");
    }
    expect(rows.map((r) => r.code)).toEqual(["DO01010201", "DO01010202", "DO01010203"]);
  });

  it("throws if the expected pcode property is missing", () => {
    const bad = { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [] } };
    expect(() => mapOchaFeature(bad, 2, "2026-01-01")).toThrow(/missing adm2_pcode/);
  });
});
