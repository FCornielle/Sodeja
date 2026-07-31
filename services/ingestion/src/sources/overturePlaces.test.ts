import { describe, expect, it } from "vitest";
import { DEFAULT_SANTIAGO_BBOX, DEFAULT_SD_BBOX, buildOverturePlacesQuery, parseBbox } from "./overturePlaces.js";

describe("parseBbox", () => {
  it("parses a comma-separated minLon,maxLon,minLat,maxLat string", () => {
    expect(parseBbox("-70.2,-69.52,18.3,18.7")).toEqual({
      minLon: -70.2,
      maxLon: -69.52,
      minLat: 18.3,
      maxLat: 18.7,
    });
  });

  it("throws for the wrong number of parts", () => {
    expect(() => parseBbox("-70.2,-69.52,18.3")).toThrow();
  });

  it("throws for a non-numeric part", () => {
    expect(() => parseBbox("-70.2,-69.52,18.3,not-a-number")).toThrow();
  });
});

describe("buildOverturePlacesQuery", () => {
  it("builds bbox-filtered SQL against the given release, with positional params", () => {
    const { sql, params } = buildOverturePlacesQuery("2026-07-22.0", DEFAULT_SD_BBOX);
    expect(sql).toContain("release/2026-07-22.0/theme=places/type=place");
    expect(sql).toContain("bbox.xmin BETWEEN ? AND ?");
    expect(sql).toContain("bbox.ymin BETWEEN ? AND ?");
    expect(params).toEqual([DEFAULT_SD_BBOX.minLon, DEFAULT_SD_BBOX.maxLon, DEFAULT_SD_BBOX.minLat, DEFAULT_SD_BBOX.maxLat]);
  });

  it("appends a confidence floor clause + param only when minConfidence is set", () => {
    const withoutFloor = buildOverturePlacesQuery("2026-07-22.0", DEFAULT_SANTIAGO_BBOX);
    expect(withoutFloor.sql).not.toContain("confidence >=");
    expect(withoutFloor.params).toHaveLength(4);

    const withFloor = buildOverturePlacesQuery("2026-07-22.0", DEFAULT_SANTIAGO_BBOX, 0.5);
    expect(withFloor.sql).toContain("AND confidence >= ?");
    expect(withFloor.params).toEqual([
      DEFAULT_SANTIAGO_BBOX.minLon,
      DEFAULT_SANTIAGO_BBOX.maxLon,
      DEFAULT_SANTIAGO_BBOX.minLat,
      DEFAULT_SANTIAGO_BBOX.maxLat,
      0.5,
    ]);
  });
});
