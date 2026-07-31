import { describe, expect, it } from "vitest";
import { parseWktPolygon } from "./wkt.js";

describe("parseWktPolygon", () => {
  it("parses a single-ring WKT polygon into GeoJSON", () => {
    const geom = parseWktPolygon(
      "POLYGON((-69.93 18.48, -69.94 18.49, -69.95 18.50, -69.93 18.48))",
    );
    expect(geom).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [-69.93, 18.48],
          [-69.94, 18.49],
          [-69.95, 18.5],
          [-69.93, 18.48],
        ],
      ],
    });
  });

  it("parses a polygon with a hole (two rings)", () => {
    const geom = parseWktPolygon(
      "POLYGON((0 0, 10 0, 10 10, 0 10, 0 0), (2 2, 4 2, 4 4, 2 4, 2 2))",
    );
    expect(geom.coordinates).toHaveLength(2);
    expect(geom.coordinates[1]).toEqual([
      [2, 2],
      [4, 2],
      [4, 4],
      [2, 4],
      [2, 2],
    ]);
  });

  it("is case-insensitive on the POLYGON keyword", () => {
    expect(() => parseWktPolygon("polygon((0 0, 1 0, 1 1, 0 0))")).not.toThrow();
  });

  it("throws on a non-polygon WKT string", () => {
    expect(() => parseWktPolygon("POINT(1 2)")).toThrow(/Not a WKT POLYGON/);
  });

  it("throws on a malformed coordinate pair", () => {
    expect(() => parseWktPolygon("POLYGON((0 0, not-a-number 1))")).toThrow(/Invalid WKT coordinate/);
  });
});
