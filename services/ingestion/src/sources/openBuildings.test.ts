import { describe, expect, it } from "vitest";
import { isOpenBuildingsConfigured, parseOpenBuildingsUrls } from "./openBuildings.js";

describe("isOpenBuildingsConfigured", () => {
  it("is false when OPEN_BUILDINGS_SOURCE_URLS is unset", () => {
    expect(isOpenBuildingsConfigured({})).toBe(false);
  });

  it("is false when OPEN_BUILDINGS_SOURCE_URLS is blank", () => {
    expect(isOpenBuildingsConfigured({ OPEN_BUILDINGS_SOURCE_URLS: "   " })).toBe(false);
  });

  it("is true when OPEN_BUILDINGS_SOURCE_URLS has content", () => {
    expect(isOpenBuildingsConfigured({ OPEN_BUILDINGS_SOURCE_URLS: "https://example.test/a.csv.gz" })).toBe(
      true,
    );
  });
});

describe("parseOpenBuildingsUrls", () => {
  it("splits and trims a comma-separated list", () => {
    const urls = parseOpenBuildingsUrls({
      OPEN_BUILDINGS_SOURCE_URLS: " https://example.test/a.csv.gz, https://example.test/b.csv.gz ",
    });
    expect(urls).toEqual(["https://example.test/a.csv.gz", "https://example.test/b.csv.gz"]);
  });

  it("returns an empty array when unset", () => {
    expect(parseOpenBuildingsUrls({})).toEqual([]);
  });
});
