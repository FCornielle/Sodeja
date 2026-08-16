import { z } from "zod";

// =========================================================================
// B-9 — Module 1: population, competition, and a demand model, all gated
// behind a real data-coverage confidence score (specs/db/schema.sql
// content.confidence_tier; docs/SODEJA_RISKS.md D2/D3).
// =========================================================================

/** Mirrors `content.confidence_tier` (specs/db/schema.sql). */
export const ConfidenceTierSchema = z.enum(["alta", "media", "baja", "insuficiente"]);
export type ConfidenceTier = z.infer<typeof ConfidenceTierSchema>;

/**
 * `POST /projects/:id/market-study?radiusM=`. Defaults to 500m, the UX
 * spec's (specs/ux/flows.md Step 3) stated default radius.
 */
export const MarketStudyRequestSchema = z.object({
  radiusM: z.coerce.number().positive().max(5000).optional().default(500),
});
export type MarketStudyRequest = z.infer<typeof MarketStudyRequestSchema>;

/**
 * `app.market_study` (specs/db/schema.sql). `populationEst`/`competitorCount`
 * are ALWAYS real computed numbers (the DB columns are `NOT NULL`) — this API
 * never nulls them out. Suppression of the number when `confidence ===
 * 'insuficiente'` (specs/ux/flows.md Step 3: "Numbers suppressed, not shown
 * greyed") is a PRESENTATION-layer rule for whichever UI consumes this
 * response, not something this endpoint does — see apps/api/README.md's
 * B-9 contract section for why, spelled out explicitly so a future frontend
 * doesn't miss it.
 */
export const MarketStudySchema = z.object({
  projectId: z.string().uuid(),
  engineVersion: z.string(),
  radiusM: z.number().int().positive(),
  populationEst: z.number().int().nonnegative(),
  competitorCount: z.number().int().nonnegative(),
  /** Competitors the user manually added (specs/ux/flows.md: "first-class input, not a fallback" — informal businesses are invisible to every dataset). */
  competitorsUserAdded: z.number().int().nonnegative(),
  /** Population per (dataset + manually-added) competitor, banded by confidence. Null when no defensible band can be computed (e.g. zero total competitors, or `confidence === 'insuficiente'`) — left null, never fabricated. */
  demandIndexLow: z.number().nullable(),
  demandIndexBase: z.number().nullable(),
  demandIndexHigh: z.number().nullable(),
  confidence: ConfidenceTierSchema,
  censusYear: z.number().int(),
  /** ISO date, or null if no POI within the radius carried a vintage (e.g. zero POIs found). */
  poiVintage: z.string().nullable(),
  computedAt: z.string().datetime(),
});
export type MarketStudy = z.infer<typeof MarketStudySchema>;

/**
 * `PATCH /projects/:id/market-study/manual-competitors`. `delta` is signed so
 * a user can correct an over-count (e.g. accidentally added twice) as well as
 * add one — the UX spec frames this as an ongoing, editable log of what the
 * user has personally observed, not a one-way counter.
 */
export const AddManualCompetitorsRequestSchema = z.object({
  delta: z.number().int(),
});
export type AddManualCompetitorsRequest = z.infer<typeof AddManualCompetitorsRequestSchema>;
