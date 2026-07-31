import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvLine } from "./csv.js";

describe("parseCsvLine", () => {
  it("splits a plain comma-separated line", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps commas embedded inside a quoted field intact", () => {
    // Real shape of Open Buildings V3's `geometry` WKT column, which
    // contains commas between coordinate pairs — the reason this parser
    // exists instead of a bare `.split(",")`.
    const line = '18.4857,-69.9314,62.4,0.91,"POLYGON((-69.93 18.48, -69.94 18.49))",76QX4V8Q+2F';
    expect(parseCsvLine(line)).toEqual([
      "18.4857",
      "-69.9314",
      "62.4",
      "0.91",
      "POLYGON((-69.93 18.48, -69.94 18.49))",
      "76QX4V8Q+2F",
    ]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    expect(parseCsvLine('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
  });
});

describe("parseCsv", () => {
  it("parses header + rows into keyed records", () => {
    const table = parseCsv("a,b\n1,2\n3,4\n");
    expect(table.header).toEqual(["a", "b"]);
    expect(table.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("returns empty header/rows for empty content", () => {
    expect(parseCsv("")).toEqual({ header: [], rows: [] });
  });

  it("skips blank lines", () => {
    const table = parseCsv("a,b\n1,2\n\n3,4\n");
    expect(table.rows).toHaveLength(2);
  });
});
