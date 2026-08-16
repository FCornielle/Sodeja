/**
 * Pure areal-interpolation logic for `computePopulationGrid.ts`
 * (geo.population_grid). Kept separate from the job so it's testable without
 * a database, same split as every `src/transform/*.ts` file in this package.
 *
 * Method: `population_est` per cell = `admin_area.population *
 * (cell_area_sqm / admin_area_sqm)` — uniform population density within the
 * admin area the cell's centroid resolves to. This is a standard, legitimate
 * simplification at this granularity, explicitly called out in
 * docs/SODEJA_MVP_BACKLOG.md's B-9 scope: real DR sub-national census data is
 * sparse (docs/SODEJA_DATA_SOURCES.md: REDATAM, no API, manual extraction
 * only), so a uniform-density split of whatever admin-level figure IS loaded
 * is the honest, real interpolation available — not a fabricated number.
 */

/**
 * `adminPopulation`/`adminAreaSqm` are `null` together whenever the caller
 * found no `geo.census_population` row covering the cell's centroid at any
 * admin level (see `computePopulationGrid.ts`'s query) — an honest zero, not
 * a fabricated figure, for a cell with no census backing at all.
 * `adminAreaSqm <= 0` is defensively treated the same way (never divide by a
 * non-positive area).
 */
export function apportionPopulation(
  cellAreaSqm: number,
  adminPopulation: number | null,
  adminAreaSqm: number | null,
): number {
  if (adminPopulation === null || adminAreaSqm === null || adminAreaSqm <= 0) return 0;
  return Math.max(0, Math.round(adminPopulation * (cellAreaSqm / adminAreaSqm)));
}
