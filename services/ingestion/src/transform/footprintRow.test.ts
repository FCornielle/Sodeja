import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../lib/csv.js";
import { readNdjson } from "../lib/ndjson.js";
import {
  MS_GLOBALML_LICENSE,
  MS_GLOBALML_SOURCE,
  MS_GLOBALML_VINTAGE,
  OPEN_BUILDINGS_LICENSE,
  OPEN_BUILDINGS_SOURCE,
  mapMsGlobalMlFeature,
  mapOpenBuildingsRow,
} from "./footprintRow.js";
import type { GeoJsonFeature, PolygonGeometry } from "../lib/geojson.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

describe("mapMsGlobalMlFeature", () => {
  it("maps a real fixture line (DominicanRepublic quadkey=032211023, build 2026-02-03)", async () => {
    const content = readFileSync(join(FIXTURES_DIR, "ms-globalml-sample.geojsonl"), "utf8");
    const { Readable } = await import("node:stream");
    const features: GeoJsonFeature<{ height: number; confidence: number }, PolygonGeometry>[] = [];
    for await (const feature of readNdjson<GeoJsonFeature<{ height: number; confidence: number }, PolygonGeometry>>(
      Readable.from(content),
    )) {
      features.push(feature);
    }
    expect(features.length).toBeGreaterThan(0);

    const row = mapMsGlobalMlFeature(features[0]!);
    expect(row.source).toBe(MS_GLOBALML_SOURCE);
    expect(row.sourceLicense).toBe(MS_GLOBALML_LICENSE);
    expect(row.sourceVintage).toBe(MS_GLOBALML_VINTAGE);
    expect(row.geometry.type).toBe("Polygon");
    // Every row in this real build reports confidence: -1.0 (MS's "not
    // applicable" sentinel), which must normalize to null, not -1.
    expect(row.confidence).toBeNull();
  });

  it("passes through an in-range confidence value unchanged", () => {
    const feature: GeoJsonFeature<{ height: number; confidence: number }, PolygonGeometry> = {
      type: "Feature",
      properties: { height: 5, confidence: 0.87 },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    };
    expect(mapMsGlobalMlFeature(feature).confidence).toBe(0.87);
  });

  it("rejects a non-Polygon geometry", () => {
    const feature = {
      type: "Feature" as const,
      properties: { height: -1, confidence: -1 },
      geometry: { type: "MultiPolygon", coordinates: [] },
    };
    expect(() => mapMsGlobalMlFeature(feature as never)).toThrow(/Expected MS GlobalML/);
  });
});

describe("mapOpenBuildingsRow", () => {
  it("maps real-shaped fixture CSV rows (fixture — see fixtures/open-buildings-sample.csv)", () => {
    const content = readFileSync(join(FIXTURES_DIR, "open-buildings-sample.csv"), "utf8");
    const { rows } = parseCsv(content);
    expect(rows.length).toBeGreaterThan(0);

    const mapped = rows.map(mapOpenBuildingsRow);
    for (const row of mapped) {
      expect(row.source).toBe(OPEN_BUILDINGS_SOURCE);
      expect(row.sourceLicense).toBe(OPEN_BUILDINGS_LICENSE);
      expect(row.geometry.type).toBe("Polygon");
      expect(row.confidence).not.toBeNull();
      expect(row.confidence).toBeGreaterThan(0);
      expect(row.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("throws when the geometry column is missing", () => {
    expect(() => mapOpenBuildingsRow({ confidence: "0.9" })).toThrow(/missing the geometry column/);
  });
});
