import type { QueryClient } from "@sodeja/rules";
import type { ConfidenceTier } from "@sodeja/schemas";

/**
 * B-9's own minimal read against `app.project_location` — duplicated rather
 * than imported from `../common/area-gate.js`, which only returns the
 * confirmed `area_sqm` (every prior consumer only needed the area, never the
 * point). Same "each module owns its own minimal reads against shared
 * tables" posture as `costs.repository.ts`'s doc comment.
 */
export interface ConfirmedCentroid {
  lon: number;
  lat: number;
}

/**
 * Duplicated minimal reads against `app.project` / `content.business_type` —
 * same reasoning and the same two-step shape (existence check, then business
 * type) as `costs.repository.ts`'s `fetchProjectContext`/`fetchBusinessTypeById`,
 * which `capacity.service.ts`/`opex.service.ts` both build on. Kept as one
 * function here since this module only ever needs the slug, never the full
 * `BusinessType` record `catalog`/`capacity`/`costs` resolve parameters
 * against.
 */
export interface ProjectMarketStudyContext {
  businessTypeSlug: string | null;
}

export async function fetchProjectContext(client: QueryClient, projectId: string): Promise<ProjectMarketStudyContext | null> {
  const { rows } = await client.query<{ id: string; slug: string | null }>(
    `SELECT p.id, bt.slug
       FROM app.project p
       LEFT JOIN content.business_type bt ON bt.id = p.business_type_id
      WHERE p.id = $1`,
    [projectId],
  );
  const row = rows[0];
  return row ? { businessTypeSlug: row.slug } : null;
}

export async function fetchConfirmedCentroid(client: QueryClient, projectId: string): Promise<ConfirmedCentroid | null> {
  const { rows } = await client.query<{ lon: number; lat: number }>(
    `SELECT ST_X(centroid) AS lon, ST_Y(centroid) AS lat
       FROM app.project_location
      WHERE project_id = $1 AND area_confirmed_at IS NOT NULL`,
    [projectId],
  );
  const row = rows[0];
  return row ? { lon: row.lon, lat: row.lat } : null;
}

/**
 * Sums `geo.population_grid.population_est` over every cell within
 * `radiusM` meters of the point. `ST_DWithin` on the cell polygon (not just
 * its centroid) against the point, cast to `geography` for a true metric
 * radius — same "whole cell counted if any part is within range, never
 * clipped" simplification `lib/grid.ts` (services/ingestion) documents for
 * grid generation itself; clipping every summed cell to the exact circle
 * would cost far more than the accuracy gained at 250m resolution.
 */
export async function fetchPopulationInRadius(
  client: QueryClient,
  lon: number,
  lat: number,
  radiusM: number,
): Promise<number> {
  const { rows } = await client.query<{ total: string | null }>(
    `SELECT COALESCE(SUM(population_est), 0) AS total
       FROM geo.population_grid
      WHERE ST_DWithin(cell::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
    [lon, lat, radiusM],
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Counts `geo.poi_place` rows within `radiusM` whose `category` matches the
 * project's business type. Filters on the ALREADY-normalized `category`
 * column (`services/ingestion/src/transform/poiPlaceRow.ts`'s
 * `mapOvertureCategory`, applied once at ingest time) rather than
 * re-implementing that Overture-category-to-business-type mapping here —
 * unlike `LAUNCH_AREA_PROVINCES` (duplicated across the ingestion/API
 * boundary because both sides need the raw province list), the category
 * mapping only ever needs to run once, at write time, so there is nothing to
 * duplicate.
 */
export async function fetchCompetitorCount(
  client: QueryClient,
  lon: number,
  lat: number,
  radiusM: number,
  businessTypeSlug: string,
): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*)::int AS n
       FROM geo.poi_place
      WHERE category = $4
        AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
    [lon, lat, radiusM, businessTypeSlug],
  );
  return Number(rows[0]?.n ?? 0);
}

const TIER_RANK: Record<ConfidenceTier, number> = { insuficiente: 0, baja: 1, media: 2, alta: 3 };

/**
 * The confidence tier for a market-study radius is the WORST (lowest-ranked)
 * `geo.data_coverage_cell.tier` among cells intersecting it — a radius
 * partially in a data-poor cell must not read as fully confident (same
 * conservative-aggregation reasoning `computeDataCoverage.ts`'s own doc
 * comment applies at the single-cell level). Returns `'insuficiente'`, never
 * `null`, when zero coverage cells intersect the radius at all — no coverage
 * data existing for this area IS the "insuficiente" case, not a distinct
 * "unknown" state (`app.market_study.confidence` is `NOT NULL`, mirroring
 * this).
 */
export async function fetchWorstTierInRadius(
  client: QueryClient,
  lon: number,
  lat: number,
  radiusM: number,
): Promise<ConfidenceTier> {
  const { rows } = await client.query<{ tier: ConfidenceTier }>(
    `SELECT tier
       FROM geo.data_coverage_cell
      WHERE ST_DWithin(cell::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
    [lon, lat, radiusM],
  );
  if (rows.length === 0) return "insuficiente";
  return rows.reduce<ConfidenceTier>(
    (worst, row) => (TIER_RANK[row.tier] < TIER_RANK[worst] ? row.tier : worst),
    "alta",
  );
}

/**
 * The census year backing this point: the most SPECIFIC (`ORDER BY ST_Area
 * ASC`) `geo.admin_area` intersecting the point that has a
 * `geo.census_population` row — identical resolution rule to
 * `computePopulationGrid.ts`'s own census lookup (`services/ingestion`), so
 * the year reported here always matches the year that actually produced the
 * `population_est` figure this endpoint sums. `null` when no admin area
 * covering this point has any census backing at all.
 */
export async function fetchCensusYear(client: QueryClient, lon: number, lat: number): Promise<number | null> {
  const { rows } = await client.query<{ census_year: number }>(
    `SELECT cp.census_year
       FROM geo.admin_area a
       JOIN geo.census_population cp ON cp.admin_area_id = a.id
      WHERE ST_Intersects(a.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
      ORDER BY ST_Area(a.geom) ASC
      LIMIT 1`,
    [lon, lat],
  );
  return rows[0]?.census_year ?? null;
}

/** Most recent `source_vintage` among `geo.poi_place` rows within the radius — how fresh the POI data behind this study actually is. `null` when zero POIs fall within the radius. */
export async function fetchPoiVintage(client: QueryClient, lon: number, lat: number, radiusM: number): Promise<string | null> {
  const { rows } = await client.query<{ vintage: Date | null }>(
    `SELECT MAX(source_vintage) AS vintage
       FROM geo.poi_place
      WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
    [lon, lat, radiusM],
  );
  const vintage = rows[0]?.vintage;
  return vintage ? vintage.toISOString().slice(0, 10) : null;
}

export interface MarketStudyRow {
  projectId: string;
  engineVersion: string;
  radiusM: number;
  populationEst: number;
  competitorCount: number;
  competitorsUserAdded: number;
  demandIndexLow: number | null;
  demandIndexBase: number | null;
  demandIndexHigh: number | null;
  confidence: ConfidenceTier;
  censusYear: number;
  poiVintage: string | null;
  computedAt: Date;
}

export interface UpsertMarketStudyInput {
  engineVersion: string;
  radiusM: number;
  populationEst: number;
  competitorCount: number;
  demandIndexLow: number | null;
  demandIndexBase: number | null;
  demandIndexHigh: number | null;
  confidence: ConfidenceTier;
  censusYear: number;
  poiVintage: string | null;
}

interface RawMarketStudyRow {
  project_id: string;
  engine_version: string;
  radius_m: number;
  population_est: number;
  competitor_count: number;
  competitors_user_added: number;
  demand_index_low: string | null;
  demand_index_base: string | null;
  demand_index_high: string | null;
  confidence: ConfidenceTier;
  census_year: number;
  poi_vintage: Date | null;
  computed_at: Date;
}

function toMarketStudyRow(row: RawMarketStudyRow): MarketStudyRow {
  return {
    projectId: row.project_id,
    engineVersion: row.engine_version,
    radiusM: row.radius_m,
    populationEst: row.population_est,
    competitorCount: row.competitor_count,
    competitorsUserAdded: row.competitors_user_added,
    demandIndexLow: row.demand_index_low === null ? null : Number(row.demand_index_low),
    demandIndexBase: row.demand_index_base === null ? null : Number(row.demand_index_base),
    demandIndexHigh: row.demand_index_high === null ? null : Number(row.demand_index_high),
    confidence: row.confidence,
    censusYear: row.census_year,
    poiVintage: row.poi_vintage ? row.poi_vintage.toISOString().slice(0, 10) : null,
    computedAt: row.computed_at,
  };
}

/**
 * `app.market_study` has `project_id` as its PRIMARY KEY (one row per
 * project, unlike `capacity_estimate`/`fitout_estimate`/`opex_estimate`'s
 * append-only `bigserial id` + `computed_at DESC` history) — so recomputing
 * is an UPSERT, not a plain insert. `competitors_user_added` is deliberately
 * excluded from the `DO UPDATE SET` list: a user's manually-logged
 * competitors must survive a recomputation triggered by, say, an assumption
 * edit elsewhere in the project — re-running this endpoint must never reset
 * what they already told the system about the ground truth.
 */
export async function upsertMarketStudy(
  client: QueryClient,
  projectId: string,
  input: UpsertMarketStudyInput,
): Promise<MarketStudyRow> {
  const { rows } = await client.query<RawMarketStudyRow>(
    `INSERT INTO app.market_study
       (project_id, engine_version, radius_m, population_est, competitor_count,
        demand_index_low, demand_index_base, demand_index_high, confidence, census_year, poi_vintage)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (project_id) DO UPDATE SET
       engine_version    = EXCLUDED.engine_version,
       radius_m          = EXCLUDED.radius_m,
       population_est    = EXCLUDED.population_est,
       competitor_count  = EXCLUDED.competitor_count,
       demand_index_low  = EXCLUDED.demand_index_low,
       demand_index_base = EXCLUDED.demand_index_base,
       demand_index_high = EXCLUDED.demand_index_high,
       confidence        = EXCLUDED.confidence,
       census_year       = EXCLUDED.census_year,
       poi_vintage       = EXCLUDED.poi_vintage,
       computed_at       = now()
     RETURNING *`,
    [
      projectId,
      input.engineVersion,
      input.radiusM,
      input.populationEst,
      input.competitorCount,
      input.demandIndexLow,
      input.demandIndexBase,
      input.demandIndexHigh,
      input.confidence,
      input.censusYear,
      input.poiVintage,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("app.market_study upsert returned no row");
  return toMarketStudyRow(row);
}

/** Read-only lookup, used before a recomputation to read the current `competitors_user_added` without writing anything (see `upsertMarketStudy`'s doc comment on why that value must survive a recompute). `null` if no row exists yet — the first computation for a project. */
export async function fetchMarketStudy(client: QueryClient, projectId: string): Promise<MarketStudyRow | null> {
  const { rows } = await client.query<RawMarketStudyRow>(
    "SELECT * FROM app.market_study WHERE project_id = $1",
    [projectId],
  );
  const row = rows[0];
  return row ? toMarketStudyRow(row) : null;
}

/**
 * `null` when no `app.market_study` row exists yet for this project — the
 * service layer turns that into a 404 ("compute a market study first"),
 * since adding a manually-observed competitor to a study that has never been
 * computed has nothing to attach to.
 */
export async function incrementManualCompetitors(
  client: QueryClient,
  projectId: string,
  delta: number,
): Promise<MarketStudyRow | null> {
  const { rows } = await client.query<RawMarketStudyRow>(
    `UPDATE app.market_study
        SET competitors_user_added = GREATEST(competitors_user_added + $2, 0)
      WHERE project_id = $1
      RETURNING *`,
    [projectId, delta],
  );
  const row = rows[0];
  return row ? toMarketStudyRow(row) : null;
}
