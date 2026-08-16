import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ENGINE_VERSION, makeRange, numberCompare, type Range } from "@sodeja/calc";
import { withUserSession } from "@sodeja/db";
import type { ConfidenceTier, MarketStudy, MarketStudyRequest } from "@sodeja/schemas";
import { requireConfirmedArea } from "../common/area-gate.js";
import {
  fetchCensusYear,
  fetchCompetitorCount,
  fetchConfirmedCentroid,
  fetchMarketStudy,
  fetchPoiVintage,
  fetchPopulationInRadius,
  fetchProjectContext,
  fetchWorstTierInRadius,
  incrementManualCompetitors,
  upsertMarketStudy,
  type MarketStudyRow,
} from "./market-study.repository.js";

function toDto(row: MarketStudyRow): MarketStudy {
  return {
    projectId: row.projectId,
    engineVersion: row.engineVersion,
    radiusM: row.radiusM,
    populationEst: row.populationEst,
    competitorCount: row.competitorCount,
    competitorsUserAdded: row.competitorsUserAdded,
    demandIndexLow: row.demandIndexLow,
    demandIndexBase: row.demandIndexBase,
    demandIndexHigh: row.demandIndexHigh,
    confidence: row.confidence,
    censusYear: row.censusYear,
    poiVintage: row.poiVintage,
    computedAt: row.computedAt.toISOString(),
  };
}

/**
 * Band half-width, as a fraction of the base demand index, per confidence
 * tier — a documented product decision, not a cited standard (same honesty
 * posture as B-11's capacity ratios and B-9's coverage-tier thresholds,
 * `services/ingestion/src/transform/coverageTier.ts`). Widens as confidence
 * drops so a shakier data foundation produces a visibly wider band rather
 * than the same fabricated-looking precision regardless of how little the
 * system actually knows — `'insuficiente'` has no entry because
 * `computeDemandIndex` below never computes a band for it at all.
 */
const DEMAND_INDEX_BAND_FRACTION: Record<Exclude<ConfidenceTier, "insuficiente">, number> = {
  alta: 0.1,
  media: 0.25,
  baja: 0.5,
};

/**
 * `demand_index` = population within the radius per (dataset + manually
 * logged) competitor — a real, computed, documented heuristic for "how much
 * unmet demand per existing business," not a cited benchmark (none exists —
 * docs/SODEJA_DATA_SOURCES.md has no DR demand-modelling standard). Returns
 * `null` (never a fabricated figure) when: confidence is `'insuficiente'`
 * (the number this would be built from is itself not trustworthy), or total
 * competitors is zero (population-per-zero-competitors is undefined, not an
 * infinite opportunity — reported as "no comparable business found nearby,"
 * not computed as a number).
 */
function computeDemandIndex(
  populationEst: number,
  totalCompetitors: number,
  confidence: ConfidenceTier,
): Range<number> | null {
  if (confidence === "insuficiente" || totalCompetitors === 0) return null;
  const base = populationEst / totalCompetitors;
  const fraction = DEMAND_INDEX_BAND_FRACTION[confidence];
  return makeRange(base * (1 - fraction), base, base * (1 + fraction), numberCompare);
}

/**
 * B-9 (Module 1, market study) — population + competition + a demand index,
 * gated behind `geo.data_coverage_cell`'s real coverage-tier signal (risk D3:
 * "uneven data coverage silently reads as 'low competition' instead of 'low
 * data'"). This service always computes and stores a real number
 * (`app.market_study.population_est`/`competitor_count` are `NOT NULL`) —
 * suppressing the figure when `confidence === 'insuficiente'` is a
 * presentation-layer decision for whichever UI reads this response
 * (specs/ux/flows.md Step 3), spelled out in `MarketStudySchema`'s doc
 * comment and `apps/api/README.md`'s B-9 contract section.
 */
@Injectable()
export class MarketStudyService {
  async computeMarketStudy(userId: string, projectId: string, input: MarketStudyRequest): Promise<MarketStudy> {
    return withUserSession(userId, async (client) => {
      const context = await fetchProjectContext(client, projectId);
      if (!context) {
        throw new NotFoundException(`project ${projectId} not found`);
      }

      // B-7a's gate, enforced for real (risk T1) — a market study is centred
      // on the confirmed site, same as capacity/costs/finance.
      await requireConfirmedArea(client, projectId);

      if (context.businessTypeSlug === null) {
        throw new ConflictException("project has no business type set; cannot count competitors");
      }

      const centroid = await fetchConfirmedCentroid(client, projectId);
      if (!centroid) {
        // requireConfirmedArea already asserted area_confirmed_at IS NOT
        // NULL, so a missing centroid here would mean project_location
        // itself vanished between those two reads — not expected in
        // practice, but fail loudly rather than silently computing from a
        // null point.
        throw new Error(`internal: project ${projectId} passed the area gate but has no confirmed centroid`);
      }

      const { radiusM } = input;
      const [populationEst, competitorCount, confidence, censusYear, poiVintage] = await Promise.all([
        fetchPopulationInRadius(client, centroid.lon, centroid.lat, radiusM),
        fetchCompetitorCount(client, centroid.lon, centroid.lat, radiusM, context.businessTypeSlug),
        fetchWorstTierInRadius(client, centroid.lon, centroid.lat, radiusM),
        fetchCensusYear(client, centroid.lon, centroid.lat),
        fetchPoiVintage(client, centroid.lon, centroid.lat, radiusM),
      ]);

      // Preserve competitors_user_added across a recomputation (see
      // upsertMarketStudy's doc comment) — read it BEFORE upserting so the
      // demand index below can factor in what the user has already told the
      // system, not just the dataset count. A pure read; the row it finds
      // (if any) is left untouched here.
      const existing = await fetchMarketStudy(client, projectId);
      const competitorsUserAdded = existing?.competitorsUserAdded ?? 0;

      const demandIndex = computeDemandIndex(populationEst, competitorCount + competitorsUserAdded, confidence);

      const row = await upsertMarketStudy(client, projectId, {
        engineVersion: ENGINE_VERSION,
        radiusM,
        populationEst,
        competitorCount,
        demandIndexLow: demandIndex?.pessimistic ?? null,
        demandIndexBase: demandIndex?.base ?? null,
        demandIndexHigh: demandIndex?.optimistic ?? null,
        confidence,
        // census_year is NOT NULL on app.market_study; a point with no
        // census backing anywhere is exactly the 'insuficiente' case this
        // module exists to surface, so fall back to the current year rather
        // than fail the whole computation — the confidence tier is what
        // actually communicates "don't trust this," not this column, which
        // only exists to date whatever census figure WAS used.
        censusYear: censusYear ?? new Date().getUTCFullYear(),
        poiVintage,
      });

      return toDto(row);
    });
  }

  async addManualCompetitors(userId: string, projectId: string, delta: number): Promise<MarketStudy> {
    return withUserSession(userId, async (client) => {
      const row = await incrementManualCompetitors(client, projectId, delta);
      if (!row) {
        throw new NotFoundException(
          `project ${projectId} has no market study yet — POST /projects/:id/market-study first`,
        );
      }
      return toDto(row);
    });
  }
}
