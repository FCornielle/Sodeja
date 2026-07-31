import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCensusCsv } from "./censusRow.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

describe("parseCensusCsv", () => {
  it("parses the fixture extract into validated rows", () => {
    const content = readFileSync(join(FIXTURES_DIR, "census-extract-FIXTURE.csv"), "utf8");
    const rows = parseCensusCsv(content, "2022-01-01");

    expect(rows).toHaveLength(3);
    const pais = rows.find((r) => r.adminLevel === "pais")!;
    // The national total in the fixture is the real ONE Censo 2022 figure
    // (docs/SODEJA_DATA_SOURCES.md); only the sub-national split is made up.
    expect(pais.population).toBe(10_760_028);
    expect(pais.households).toBe(4_418_619);
    expect(pais.censusYear).toBe(2022);
    expect(pais.adminAreaCode).toBe("DO");
  });

  it("throws with a row number on an invalid admin_level", () => {
    const csv = "admin_level,admin_area_code,population,census_year\nregion,DO01,100,2022\n";
    expect(() => parseCensusCsv(csv, "2022-01-01")).toThrow(/row 2.*admin_level/);
  });

  it("throws on a non-integer population", () => {
    const csv = "admin_level,admin_area_code,population,census_year\npais,DO,not-a-number,2022\n";
    expect(() => parseCensusCsv(csv, "2022-01-01")).toThrow(/population/);
  });

  it("throws when a required column is missing", () => {
    const csv = "admin_level,admin_area_code,population\npais,DO,100\n";
    expect(() => parseCensusCsv(csv, "2022-01-01")).toThrow(/missing required column "census_year"/);
  });

  it("defaults source and source_vintage when the columns are absent", () => {
    const csv = "admin_level,admin_area_code,population,census_year\npais,DO,100,2022\n";
    const [row] = parseCensusCsv(csv, "2022-06-15");
    expect(row!.source).toBe("ONE Censo 2022");
    expect(row!.sourceVintage).toBe("2022-06-15");
    expect(row!.households).toBeNull();
  });
});
