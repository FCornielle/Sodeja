import { z } from "zod";
import { CurrencySchema, ProvenanceSchema, ResolvedParameterSchema } from "./primitives.js";

/**
 * B-11a wire contract: one row per `app.project_assumption`
 * (specs/db/schema.sql), camelCase. This is the exact shape
 * `GET /projects/:id/assumptions` returns (as `ProjectAssumption[]`) and that
 * `PATCH /projects/:id/assumptions/:key` both accepts an update against and
 * returns.
 *
 * How a consumer (B-12/B-14/B-15) should read "the current value of
 * assumption X for project Y": call `GET /projects/:id/assumptions`, find the
 * row with `key === X`, and read `valueLow`/`valueBase`/`valueHigh` — those
 * three fields are ALWAYS the current, effective value, whether or not
 * `isOverridden` is true. `defaultParameterValueId` is provenance metadata
 * only (which `content.parameter_value` row the pre-fill came from); it is
 * never re-resolved or re-read for the current value once a row exists.
 */
export const ProjectAssumptionSchema = z
  .object({
    id: z.number().int(),
    projectId: z.string().uuid(),
    key: z.string().min(1),
    labelEs: z.string().min(1),
    unit: z.string().min(1),
    valueLow: z.number().finite(),
    valueBase: z.number().finite(),
    valueHigh: z.number().finite(),
    /** null for unitless ratios, mirrors content.parameter_value.currency */
    currency: CurrencySchema.nullable(),
    provenance: ProvenanceSchema,
    /** content.parameter_value.id the pre-fill was materialized from; null if none applied. */
    defaultParameterValueId: z.number().int().nullable(),
    /** True once a user has PATCHed this assumption at least once. */
    isOverridden: z.boolean(),
    /**
     * True when the current valueBase falls outside the ORIGINAL default's
     * [valueLow, valueHigh] band. A warning signal only — never a rejection
     * (risk D1: "the user may know their market better than the benchmark
     * does").
     */
    implausibleFlag: z.boolean(),
    updatedAt: z.string().datetime(),
  })
  .refine((a) => a.valueLow <= a.valueBase && a.valueBase <= a.valueHigh, {
    message: "valueLow must be <= valueBase, and valueBase must be <= valueHigh",
  });
export type ProjectAssumption = z.infer<typeof ProjectAssumptionSchema>;

/**
 * The four calculation-output tables (specs/db/schema.sql section
 * "Calculation outputs (Modules 6, 9, 10, 7)"). `invalidated[]` on the PATCH
 * response names exactly these — never anything else.
 */
export const EstimateTypeSchema = z.enum([
  "capacity_estimate",
  "fitout_estimate",
  "opex_estimate",
  "financial_projection",
]);
export type EstimateType = z.infer<typeof EstimateTypeSchema>;

export const AssumptionOverrideRequestSchema = z
  .object({
    valueLow: z.number().finite(),
    valueBase: z.number().finite(),
    valueHigh: z.number().finite(),
  })
  .refine((v) => v.valueLow <= v.valueBase && v.valueBase <= v.valueHigh, {
    message: "valueLow must be <= valueBase, and valueBase must be <= valueHigh",
  });
export type AssumptionOverrideRequest = z.infer<typeof AssumptionOverrideRequestSchema>;

/**
 * `invalidated`: the estimate types that are now potentially stale as a
 * result of THIS SINGLE PATCH, derived from a static
 * parameter-table-domain -> estimate-type map (apps/api/src/projects/
 * assumption-invalidation.ts). It is a hint for the client to prompt a
 * recompute, not an audit log and not a claim that those estimates were
 * actually recomputed — B-12/B-14/B-15/B-17 own recomputation itself.
 */
export const AssumptionOverrideResponseSchema = z.object({
  assumption: ProjectAssumptionSchema,
  invalidated: z.array(EstimateTypeSchema),
});
export type AssumptionOverrideResponse = z.infer<typeof AssumptionOverrideResponseSchema>;

/**
 * The minimal `POST /projects` body (B-11a: just enough to make the
 * assumptions sub-resource testable end-to-end). No update/delete/list DTOs
 * exist yet — that is full `projects` CRUD, explicitly out of this item's
 * scope.
 */
export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1),
  businessTypeId: z.number().int().positive(),
  jurisdictionId: z.number().int().positive(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const ProjectStatusSchema = z.enum(["draft", "complete", "archived"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  businessTypeId: z.number().int(),
  jurisdictionId: z.number().int(),
  status: ProjectStatusSchema,
  createdAt: z.string().datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

/**
 * B-11 catalog entry: one business type plus every `domain='capacity'`
 * parameter resolved for it (today's date, no jurisdiction override — these
 * ratios are national/generic, not jurisdiction-scoped). `parameters` may be
 * a strict subset of "every capacity parameter_table that exists" when a
 * business type has no covered ratio (e.g. 'salon' — see the B-11 migration
 * for what was deliberately left uncited rather than fabricated).
 */
export const BusinessTypeCatalogEntrySchema = z.object({
  slug: z.string().min(1),
  nameEs: z.string().min(1),
  descriptionEs: z.string().nullable(),
  parameters: z.array(ResolvedParameterSchema),
});
export type BusinessTypeCatalogEntry = z.infer<typeof BusinessTypeCatalogEntrySchema>;

// =========================================================================
// B-7a — area confirmation gate
// =========================================================================

/**
 * Mirrors `app.area_source` (specs/db/schema.sql). `PUT /projects/:id/location`
 * (the only area-confirmation endpoint this backlog slice builds) always
 * writes `'user_entered'` — `'footprint_dataset'`/`'user_drawn'` require the
 * map UI and footprint-confirm flow (B-7/B-8), not built here.
 */
export const AreaSourceSchema = z.enum(["footprint_dataset", "user_drawn", "user_entered"]);
export type AreaSource = z.infer<typeof AreaSourceSchema>;

/**
 * `PUT /projects/:id/location` body. The narrowest possible slice of B-7a:
 * no map, no polygon, no footprint suggestion — just an explicit,
 * user-typed area and point location, which is enough to satisfy the
 * `area_confirmed_at IS NULL OR area_sqm IS NOT NULL` gate that
 * capacity/fit-out/opex all sit behind (risk T1).
 */
export const ConfirmProjectLocationRequestSchema = z.object({
  areaSqm: z.number().positive(),
  centroidLon: z.number().min(-180).max(180),
  centroidLat: z.number().min(-90).max(90),
});
export type ConfirmProjectLocationRequest = z.infer<typeof ConfirmProjectLocationRequestSchema>;

export const ProjectLocationSchema = z.object({
  projectId: z.string().uuid(),
  areaSqm: z.number().positive(),
  areaSource: AreaSourceSchema,
  /** Non-null once confirmed — this endpoint always sets it, so always present in the response. */
  areaConfirmedAt: z.string().datetime(),
  centroidLon: z.number(),
  centroidLat: z.number(),
  updatedAt: z.string().datetime(),
});
export type ProjectLocation = z.infer<typeof ProjectLocationSchema>;

// =========================================================================
// B-12 — capacity estimate
// =========================================================================

/**
 * `POST /projects/:id/capacity-estimate` body. `staffCount` is the ONLY way
 * to populate `staff_*` on the stored estimate: no staffing-density ratio
 * was seeded (packages/db/migrations/1785520000000_seed-capacity-parameters.sql
 * deliberately left it uncovered — no genuine DR or international standard
 * was found with real confidence), so a fabricated ratio is not an option.
 * Omit it and `staff_*` is persisted as `null`.
 */
export const CapacityEstimateRequestSchema = z.object({
  staffCount: z.number().int().nonnegative().optional(),
});
export type CapacityEstimateRequest = z.infer<typeof CapacityEstimateRequestSchema>;

export const CapacityEstimateSchema = z.object({
  id: z.number().int(),
  projectId: z.string().uuid(),
  engineVersion: z.string().min(1),
  asOfDate: z.string(),
  inputsSnapshot: z.record(z.string(), z.unknown()),
  resultsJson: z.record(z.string(), z.unknown()),
  seatsLow: z.number().int().nullable(),
  seatsBase: z.number().int().nullable(),
  seatsHigh: z.number().int().nullable(),
  staffLow: z.number().int().nullable(),
  staffBase: z.number().int().nullable(),
  staffHigh: z.number().int().nullable(),
  dailyCustomersLow: z.number().int().nullable(),
  dailyCustomersBase: z.number().int().nullable(),
  dailyCustomersHigh: z.number().int().nullable(),
  computedAt: z.string().datetime(),
});
export type CapacityEstimate = z.infer<typeof CapacityEstimateSchema>;

// =========================================================================
// B-14 — fit-out cost estimate
// =========================================================================

/**
 * `POST /projects/:id/fitout-estimate` body. No DR commercial fit-out cost
 * basis exists at any confidence level (docs/SODEJA_DATA_SOURCES.md table c)
 * — the base construction cost per m² is therefore a REQUIRED, explicit
 * user input (provenance 'usuario'), never a seeded default. The caller
 * supplies their own low/base/high band (e.g. from a contractor quote);
 * the engine applies the ICDV escalation factor on top — it does not invent
 * the spread itself.
 */
export const FitoutEstimateRequestSchema = z
  .object({
    baseCostPerSqmLow: z.number().positive(),
    baseCostPerSqmBase: z.number().positive(),
    baseCostPerSqmHigh: z.number().positive(),
    currency: CurrencySchema.default("DOP"),
  })
  .refine((v) => v.baseCostPerSqmLow <= v.baseCostPerSqmBase && v.baseCostPerSqmBase <= v.baseCostPerSqmHigh, {
    message: "baseCostPerSqmLow must be <= baseCostPerSqmBase, and baseCostPerSqmBase must be <= baseCostPerSqmHigh",
  });
export type FitoutEstimateRequest = z.infer<typeof FitoutEstimateRequestSchema>;

export const FitoutEstimateSchema = z.object({
  id: z.number().int(),
  projectId: z.string().uuid(),
  engineVersion: z.string().min(1),
  asOfDate: z.string(),
  inputsSnapshot: z.record(z.string(), z.unknown()),
  resultsJson: z.record(z.string(), z.unknown()),
  totalLowAmount: z.number(),
  totalBaseAmount: z.number(),
  totalHighAmount: z.number(),
  currency: CurrencySchema,
  /** The ICDV figure's real date (Dec 2025) — never `asOfDate`, which is when this estimate was computed. */
  indexBaseDate: z.string(),
  computedAt: z.string().datetime(),
});
export type FitoutEstimate = z.infer<typeof FitoutEstimateSchema>;

// =========================================================================
// B-15 — operating cost estimate
// =========================================================================

/**
 * DR company size (micro/pequeña/mediana/grande) is a legal determination
 * from dual criteria (headcount AND annual gross sales, Ley 488-08 / MICM
 * Res. 79-2025) that this system cannot evaluate — no financial projection
 * (gross sales) exists yet (that is B-17). `companySize` is therefore a
 * required, explicit input here — never guessed from headcount alone.
 */
export const CompanySizeSchema = z.enum(["micro", "pequena", "mediana", "grande"]);
export type CompanySize = z.infer<typeof CompanySizeSchema>;

/**
 * `POST /projects/:id/opex-estimate` body. `staffCount` overrides
 * `app.capacity_estimate.staff_base` (the normal source) when that estimate
 * has no staff figure — e.g. it was computed before a staff count was ever
 * supplied. Rent/utilities are optional, curated-nowhere line items
 * (docs/SODEJA_DATA_SOURCES.md table c): supplying neither still produces a
 * valid (partial) estimate from payroll + TSS + INFOTEP alone.
 */
export const OpexEstimateRequestSchema = z.object({
  companySize: CompanySizeSchema,
  staffCount: z.number().int().nonnegative().optional(),
  monthlyRentDop: z.number().nonnegative().optional(),
  monthlyUtilitiesDop: z.number().nonnegative().optional(),
});
export type OpexEstimateRequest = z.infer<typeof OpexEstimateRequestSchema>;

export const OpexEstimateSchema = z.object({
  id: z.number().int(),
  projectId: z.string().uuid(),
  engineVersion: z.string().min(1),
  asOfDate: z.string(),
  inputsSnapshot: z.record(z.string(), z.unknown()),
  resultsJson: z.record(z.string(), z.unknown()),
  monthlyLowAmount: z.number(),
  monthlyBaseAmount: z.number(),
  monthlyHighAmount: z.number(),
  currency: CurrencySchema,
  computedAt: z.string().datetime(),
});
export type OpexEstimate = z.infer<typeof OpexEstimateSchema>;

// =========================================================================
// B-17 — financial projection
// =========================================================================

/**
 * `POST /projects/:id/financial-projection` body. Monthly revenue is the
 * ONE genuinely new input this endpoint introduces, and it is REQUIRED and
 * explicit: no DR micro-business revenue benchmark exists at any confidence
 * level (docs/SODEJA_DATA_SOURCES.md table (c), "Micro-business revenue
 * benchmarks" — "users supply their own, product supplies plausibility
 * bands only"). It is never derived from `capacity_estimate`'s seat/customer
 * counts via an invented ticket-price x turnover formula — B-12 deliberately
 * left `dailyCustomers` null for exactly this reason (no rotación benchmark
 * exists either); chaining one fabricated assumption onto another would
 * compound the exact problem this task exists to avoid. Amounts are in the
 * project's `reporting_currency` — there is no separate currency field here
 * because the projection always reports in the project's pinned currency
 * (specs/db/schema.sql `app.project`).
 *
 * `horizonMonths` defaults to 36 — a defensible standard horizon for a
 * break-even analysis; no spec value is given anywhere — and is capped at
 * 60 (specs/api/openapi.yaml's own cap) to keep `results_json`'s monthly
 * series a bounded size.
 */
export const FinancialProjectionRequestSchema = z
  .object({
    monthlyRevenueLow: z.number().nonnegative(),
    monthlyRevenueBase: z.number().nonnegative(),
    monthlyRevenueHigh: z.number().nonnegative(),
    horizonMonths: z.number().int().positive().max(60).default(36),
  })
  .refine((v) => v.monthlyRevenueLow <= v.monthlyRevenueBase && v.monthlyRevenueBase <= v.monthlyRevenueHigh, {
    message: "monthlyRevenueLow must be <= monthlyRevenueBase, and monthlyRevenueBase must be <= monthlyRevenueHigh",
  });
export type FinancialProjectionRequest = z.infer<typeof FinancialProjectionRequestSchema>;

export const FinancialProjectionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  engineVersion: z.string().min(1),
  /** Always `[]` — no permit/tax `content.rule_pack` rows exist yet (B-18/B-11 seeded only parameter values, never a rule pack). */
  rulePackIds: z.array(z.number().int()),
  asOfDate: z.string(),
  fxUsdDop: z.number().nullable(),
  inputsSnapshot: z.record(z.string(), z.unknown()),
  resultsJson: z.record(z.string(), z.unknown()),
  /**
   * Nullable across all three bounds — a scenario legitimately may not cross
   * zero within the projection horizon. A `null` here must render as "no
   * alcanza el punto de equilibrio en el horizonte proyectado", never as
   * zero and never as the horizon length (specs/db/schema.sql
   * `app.financial_projection`).
   */
  breakevenMonthLow: z.number().int().nullable(),
  breakevenMonthBase: z.number().int().nullable(),
  breakevenMonthHigh: z.number().int().nullable(),
  currency: CurrencySchema,
  computedAt: z.string().datetime(),
});
export type FinancialProjection = z.infer<typeof FinancialProjectionSchema>;
