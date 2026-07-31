import { parseCsv } from "../lib/csv.js";
import type { AdminLevel } from "./adminAreaRow.js";

export interface CensusExtractRow {
  adminLevel: AdminLevel;
  adminAreaCode: string;
  population: number;
  households: number | null;
  censusYear: number;
  source: string;
  sourceVintage: string; // ISO date
}

const VALID_LEVELS: ReadonlySet<string> = new Set([
  "pais",
  "provincia",
  "municipio",
  "seccion",
  "barrio",
]);

const REQUIRED_COLUMNS = [
  "admin_level",
  "admin_area_code",
  "population",
  "census_year",
] as const;

/**
 * Parses a structured census extract CSV — the manual-extraction output
 * documented in README.md's "Census data (ONE Censo 2022)" section — into
 * validated rows ready to upsert into geo.census_population.
 *
 * Expected columns: admin_level, admin_area_code, population, households
 * (optional, blank allowed), census_year, source (optional, defaults to
 * "ONE Censo 2022"), source_vintage (optional ISO date, defaults to
 * `defaultVintage`).
 *
 * Deliberately strict: throws with a row-numbered message on any malformed
 * row rather than silently skipping it, per the ingestion contract's ban on
 * writing a geo.* row without complete provenance.
 */
export function parseCensusCsv(content: string, defaultVintage: string): CensusExtractRow[] {
  const { header, rows } = parseCsv(content);

  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) {
      throw new Error(
        `Census extract CSV is missing required column "${column}". Expected: ${REQUIRED_COLUMNS.join(", ")}`,
      );
    }
  }

  return rows.map((row, index) => {
    const rowNum = index + 2; // +1 for header, +1 for 1-based

    const adminLevel = row.admin_level?.trim();
    if (!adminLevel || !VALID_LEVELS.has(adminLevel)) {
      throw new Error(
        `Census extract row ${rowNum}: invalid admin_level "${row.admin_level}" (expected one of pais/provincia/municipio/seccion/barrio)`,
      );
    }

    const adminAreaCode = row.admin_area_code?.trim();
    if (!adminAreaCode) {
      throw new Error(`Census extract row ${rowNum}: admin_area_code is required`);
    }

    const population = Number(row.population);
    if (!Number.isInteger(population) || population < 0) {
      throw new Error(`Census extract row ${rowNum}: population "${row.population}" is not a non-negative integer`);
    }

    const householdsRaw = row.households?.trim();
    let households: number | null = null;
    if (householdsRaw) {
      households = Number(householdsRaw);
      if (!Number.isInteger(households) || households < 0) {
        throw new Error(`Census extract row ${rowNum}: households "${row.households}" is not a non-negative integer`);
      }
    }

    const censusYear = Number(row.census_year);
    if (!Number.isInteger(censusYear) || censusYear < 1950 || censusYear > 2100) {
      throw new Error(`Census extract row ${rowNum}: census_year "${row.census_year}" is not a plausible year`);
    }

    return {
      adminLevel: adminLevel as AdminLevel,
      adminAreaCode,
      population,
      households,
      censusYear,
      source: row.source?.trim() || "ONE Censo 2022",
      sourceVintage: row.source_vintage?.trim() || defaultVintage,
    };
  });
}
