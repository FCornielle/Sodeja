/**
 * Pure scoring/tiering logic for `computeDataCoverage.ts`
 * (geo.data_coverage_cell — B-9's coverage-tier suppression mechanism, risk
 * D3). Kept separate from the job so it's testable without a database, same
 * split as every `src/transform/*.ts` file in this package.
 *
 * All three sub-scores and the tier thresholds below are DOCUMENTED PRODUCT
 * DECISIONS, not cited standards — no source in docs/SODEJA_DATA_SOURCES.md
 * or docs/SODEJA_RISKS.md specifies exact coverage-scoring cutoffs, the same
 * honesty posture B-11's capacity ratios and B-14's fit-out uplifts take
 * when no defensible benchmark exists.
 */

/**
 * Mirrors `content.confidence_tier` (specs/db/schema.sql). Defined locally
 * rather than imported from `@sodeja/schemas` — this package has no runtime
 * dependency on that package (every other job/transform file here uses its
 * own local row/type shapes; see e.g. `poiPlaceRow.ts`'s `PoiSource`), and a
 * four-value string union is cheap to keep in sync by hand.
 */
export type ConfidenceTier = "alta" | "media" | "baja" | "insuficiente";

/**
 * Reference density for `footprint_score`: the number of
 * `geo.building_footprint` rows inside one `GRID_CELL_SIZE_M`-meter cell
 * (0.0625 km^2 / 6.25 ha at the current 250m cell size) that scores a full
 * 1.0. 30 buildings per 6.25 ha (~4.8/ha) is a plausible dense DR urban
 * block density given typical small commercial/residential lot sizes — a
 * heuristic anchor, not a cited standard (same posture as B-11's capacity
 * ratios). `footprint_score` scales linearly from 0 to this reference and
 * clamps at 1 beyond it.
 */
export const FOOTPRINT_REFERENCE_COUNT = 30;

/**
 * Reference weighted-density for `poi_score`. The raw input is not a plain
 * count but SUM(COALESCE(confidence, 0.5)) over `geo.poi_place` rows in the
 * cell — the P0-1 spike (docs/SODEJA_DATA_SOURCES.md) found a majority of DR
 * Overture records sit below 0.7 confidence and explicitly recommended
 * treating `confidence` as a first-class weight, not a blunt filter, so a
 * cell full of low-confidence places scores lower than the same raw count of
 * high-confidence ones. Missing confidence (Overture does not report it for
 * every place) is treated as neutral (0.5), not zero evidence and not full
 * confidence. The reference value 10 is anchored loosely to the P0-1 spike's
 * measured urban-core densities translated to this cell size: Santiago core
 * ~67 places/km^2 -> ~4.2/cell; Santo Domingo core ~186/km^2 -> ~11.6/cell;
 * 10 sits between them, so reaching a full poi_score of 1.0 requires
 * something close to Santo Domingo-core-level density, weighted down further
 * by confidence — deliberately not a low bar.
 */
export const POI_REFERENCE_WEIGHT = 10;

/**
 * Tier thresholds against the equal-weighted average of the three [0,1]
 * sub-scores. Picked, not derived: `alta` requires all three scores to be
 * meaningfully positive on average; `insuficiente` is reserved for cells
 * where the average signal is genuinely thin (composite < 0.20) — e.g. an
 * empty/near-empty database (footprint_score=0, poi_score=0, census_score=0)
 * composites to exactly 0, correctly landing in `insuficiente` (risk D3's
 * mechanism working as designed, not a bug).
 */
export const TIER_THRESHOLD_ALTA = 0.7;
export const TIER_THRESHOLD_MEDIA = 0.45;
export const TIER_THRESHOLD_BAJA = 0.2;

/** Linear-to-1.0 normalization, clamped, against a documented reference density. */
export function scoreFootprintDensity(footprintCount: number): number {
  return Math.min(Math.max(footprintCount, 0) / FOOTPRINT_REFERENCE_COUNT, 1);
}

/** Same normalization shape as `scoreFootprintDensity`, against the confidence-weighted POI reference. */
export function scorePoiDensity(confidenceWeightedSum: number): number {
  return Math.min(Math.max(confidenceWeightedSum, 0) / POI_REFERENCE_WEIGHT, 1);
}

export interface CoverageCellResult {
  footprintScore: number;
  poiScore: number;
  censusScore: 0 | 1;
  composite: number;
  tier: ConfidenceTier;
}

function tierForComposite(composite: number): ConfidenceTier {
  if (composite >= TIER_THRESHOLD_ALTA) return "alta";
  if (composite >= TIER_THRESHOLD_MEDIA) return "media";
  if (composite >= TIER_THRESHOLD_BAJA) return "baja";
  return "insuficiente";
}

/**
 * Combines the three raw per-cell signals into `footprint_score`/`poi_score`
 * (both normalized 0-1 here) plus the already-binary `census_score`, and
 * derives `tier` from their simple, equal-weighted average. `censusScore`
 * is computed by the caller (a presence check against
 * `geo.census_population`, not a density) — this function only combines and
 * tiers, it does not decide census presence.
 */
export function computeCoverageCell(
  footprintCount: number,
  poiConfidenceWeightedSum: number,
  censusScore: 0 | 1,
): CoverageCellResult {
  const footprintScore = scoreFootprintDensity(footprintCount);
  const poiScore = scorePoiDensity(poiConfidenceWeightedSum);
  const composite = (footprintScore + poiScore + censusScore) / 3;
  return { footprintScore, poiScore, censusScore, composite, tier: tierForComposite(composite) };
}
