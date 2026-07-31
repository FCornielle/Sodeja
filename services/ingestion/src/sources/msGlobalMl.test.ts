import { describe, expect, it } from "vitest";
import { filterByRegion, parseDatasetLinksCsv } from "./msGlobalMl.js";

// A trimmed real excerpt of dataset-links.csv (fetched directly from
// https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv
// during development of this job) — same header and row shape, just two
// DominicanRepublic rows plus one unrelated row to exercise the region
// filter.
const SAMPLE_CSV = `Location,QuadKey,Url,Size,UploadDate
DominicanRepublic,032211023,https://minedbuildings.z5.web.core.windows.net/global-buildings/2026-02-03/global-buildings.geojsonl/RegionName=DominicanRepublic/quadkey=032211023/part-00076-4feead82-d499-422b-94cb-c036c212127a.c000.csv.gz,112.5KB,2026-02-23
DominicanRepublic,032211032,https://minedbuildings.z5.web.core.windows.net/global-buildings/2026-02-03/global-buildings.geojsonl/RegionName=DominicanRepublic/quadkey=032211032/part-00117-4feead82-d499-422b-94cb-c036c212127a.c000.csv.gz,10.5MB,2026-02-23
Haiti,032211020,https://minedbuildings.z5.web.core.windows.net/global-buildings/2026-02-03/global-buildings.geojsonl/RegionName=Haiti/quadkey=032211020/part-00001.c000.csv.gz,5.0MB,2026-02-23
`;

describe("parseDatasetLinksCsv", () => {
  it("parses Location/QuadKey/Url columns", () => {
    const links = parseDatasetLinksCsv(SAMPLE_CSV);
    expect(links).toHaveLength(3);
    expect(links[0]).toEqual({
      location: "DominicanRepublic",
      quadkey: "032211023",
      url: expect.stringContaining("quadkey=032211023"),
    });
  });
});

describe("filterByRegion", () => {
  it("keeps only rows matching the requested region", () => {
    const links = parseDatasetLinksCsv(SAMPLE_CSV);
    const dr = filterByRegion(links, "DominicanRepublic");
    expect(dr).toHaveLength(2);
    expect(dr.every((l) => l.location === "DominicanRepublic")).toBe(true);
  });

  it("returns an empty array for an unknown region", () => {
    const links = parseDatasetLinksCsv(SAMPLE_CSV);
    expect(filterByRegion(links, "Atlantis")).toEqual([]);
  });
});
