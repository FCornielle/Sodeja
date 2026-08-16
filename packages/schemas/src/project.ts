import { z } from "zod";
import { CitationSchema, CurrencySchema, ProvenanceSchema, ResolvedParameterSchema } from "./primitives.js";

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
 * Mirrors `app.area_source` (specs/db/schema.sql). Which value applies is a
 * decision only the caller can make — it records whether the confirmed area
 * came from the footprint dataset untouched, from a polygon the user drew,
 * or from a number they typed. The API never infers it (B-8).
 */
export const AreaSourceSchema = z.enum(["footprint_dataset", "user_drawn", "user_entered"]);
export type AreaSource = z.infer<typeof AreaSourceSchema>;

/**
 * `PUT /projects/:id/location` body. B-7a introduced this with area + point
 * only; B-8 adds `areaSource`, the provenance the map UI already computes
 * (whether the confirmed figure is still the dataset's own footprint area or
 * the user changed it). Optional, defaulting server-side to `'user_entered'`
 * — the pre-B-8 callers that predate the map UI genuinely only ever had a
 * typed number, so that default states what actually happened rather than
 * being a placeholder.
 */
export const ConfirmProjectLocationRequestSchema = z.object({
  areaSqm: z.number().positive(),
  centroidLon: z.number().min(-180).max(180),
  centroidLat: z.number().min(-90).max(90),
  areaSource: AreaSourceSchema.optional(),
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
// B-8 — POI use-label at the confirmed site
// =========================================================================

/**
 * `GET /projects/:id/poi-label` — the nearest `geo.poi_place` to the
 * project's confirmed centroid, so the UI can ask "there is currently a
 * [category] here, is that right?".
 *
 * All three fields are `null` together when no POI falls within the lookup
 * radius. That is a valid, common answer ("we don't know what is here"), not
 * an error — the endpoint never 404s for it, and a client must render it as
 * "no record", never as an empty/unknown category label.
 *
 * `category` is `geo.poi_place.category`, already normalized to a
 * `content.business_type.slug` at ingest time
 * (`services/ingestion/src/transform/poiPlaceRow.ts`'s `mapOvertureCategory`).
 * It is nullable independently of `name`: Overture reports plenty of places
 * whose raw category maps to no business type this product models, and those
 * rows are kept (never dropped at ingest), so "there is a named place here
 * but we can't classify it" is a real state.
 */
export const ProjectPoiLabelSchema = z.object({
  category: z.string().nullable(),
  name: z.string().nullable(),
  /** Meters from the confirmed centroid to the POI point. Null only when no POI was found. */
  distanceM: z.number().nonnegative().nullable(),
  /** `geo.poi_place.source_vintage` as an ISO date — how old the record is. Null when no POI was found. */
  sourceVintage: z.string().nullable(),
});
export type ProjectPoiLabel = z.infer<typeof ProjectPoiLabelSchema>;

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
// B-13 — layout zone parameters
// =========================================================================

/**
 * `GET /projects/:id/layout-parameters` — everything a client needs to run
 * `@sodeja/calc`'s `allocateLayoutZones` / `checkLayoutZonePlausibility`
 * itself, and nothing else. There is no server-side layout result because
 * there is nothing for the server to decide: the zone split is USER-ENTERED
 * (packages/calc/src/layout.ts's header explains at length why no zone AREA
 * SHARE is citable), so the allocation is a pure function of numbers the
 * client already holds, and `@sodeja/calc` runs identically on every client
 * (apps/mobile/README.md).
 *
 * `densityParameters` is every `domain='layout'` `content.parameter_table`
 * that resolved for the project's business type, as of today, with no
 * jurisdiction override — the same resolution B-11's `GET /business-types`
 * does for `domain='capacity'`. It is legitimately `[]` for a business type
 * with no covered zone (`salon` has none at all; see the B-13 migration,
 * packages/db/migrations/1785550000000_seed-layout-parameters.sql). An empty
 * array means "no citation covers any zone of this business type", so the
 * client runs the allocation with no plausibility comparison — it never
 * means an error, and a client must never substitute another business type's
 * density for a missing one.
 *
 * Which zone slug a given `parameterTableSlug` applies to is the client's
 * mapping to make, exactly as `LayoutZoneDensityCheck.zoneSlug` is: the
 * client owns the zone vocabulary the user typed shares against, and this
 * endpoint does not invent zone names the user never saw.
 */
export const LayoutParametersSchema = z.object({
  /** The project's CONFIRMED area (B-7a gate) — the `totalAreaSqm` argument to `allocateLayoutZones`. */
  areaSqm: z.number().positive(),
  businessTypeSlug: z.string().min(1),
  densityParameters: z.array(ResolvedParameterSchema),
  /**
   * `staff_base` of the project's latest `app.capacity_estimate` — the
   * `expectedOccupants` figure for a storage/kitchen zone check. Staff, NOT
   * seats or daily customers: an IBC stockroom/commercial-kitchen occupant
   * load counts the people working in that zone, not the customers the sales
   * floor is sized for (packages/calc/src/layout.ts,
   * `LayoutZoneDensityCheck`).
   *
   * `null` is a normal state, never an error — the client then runs
   * `allocateLayoutZones` alone and skips `checkLayoutZonePlausibility`
   * entirely. It must never pass `0` or a guessed figure in its place; the
   * engine rejects a non-positive `expectedOccupants` for exactly that
   * reason.
   */
  expectedOccupants: z.number().int().positive().nullable(),
  /**
   * Why `expectedOccupants` is `null`, or `null` when it is populated. The
   * two causes need different things from the user (compute a capacity
   * estimate at all, versus recompute one supplying `staffCount`), so they
   * are distinguished rather than collapsed into a bare absence.
   */
  expectedOccupantsReason: z.string().min(1).nullable(),
});
export type LayoutParameters = z.infer<typeof LayoutParametersSchema>;

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
  /**
   * Always `[]`. B-18 has since seeded `domain='permits'` rule packs, but the
   * projection consumes none of them — it reads `content.parameter_value`
   * (tax/labor rates) only. Not a stale empty array awaiting a backfill.
   */
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

// =========================================================================
// B-18 — permits checklist (Module 12)
// =========================================================================

/**
 * Mirrors `content.permit_requirement` (specs/db/schema.sql) and
 * `PermitRuleResult['requirement']` in `@sodeja/rules`. There is deliberately
 * no `'compliant'` / `'cleared'` / `'done'` member, and this enum must never
 * gain one (risk L3, docs/SODEJA_RISKS.md; see packages/rules/src/permits.ts's
 * own comment). A false all-clear here can cost a user their fit-out capital,
 * so the vocabulary can only say what applies to them and who to ask — never
 * that they are finished.
 */
export const PermitRequirementSchema = z.enum([
  "required",
  "likely_required",
  "not_applicable",
  "unknown",
]);
export type PermitRequirement = z.infer<typeof PermitRequirementSchema>;

/**
 * One evaluated permit rule. Structurally identical to `@sodeja/rules`'s
 * `PermitRuleResult` — this is that type's wire contract, named after the
 * checklist row it becomes rather than after the engine that produced it.
 *
 * `jurisdictionSlug` and `rulePackVersion` are per ITEM, not per checklist: a
 * single response mixes rules from the national pack with municipal overrides
 * (the `uso-suelo` rule is the seeded example — DN issues a "Certificación de
 * Uso de Suelo", Santiago a "No Objeción al Uso de Suelo"), and those packs
 * version independently. A client that wants to show "which rulebook is this
 * from" must read it off the item.
 */
export const PermitChecklistItemSchema = z.object({
  /** `content.rule.code`, stable across rule-pack versions — the client's key for an item. */
  ruleCode: z.string().min(1),
  titleEs: z.string().min(1),
  descriptionEs: z.string().nullable(),
  requirement: PermitRequirementSchema,
  /** Who to ask. Null when the rule's source names no single competent body. */
  agencyName: z.string().nullable(),
  citation: CitationSchema,
  /** `content.rule_pack.valid_from` as YYYY-MM-DD — when this content was published, not when the law took force (that is `citation.effectiveDate`). */
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  jurisdictionSlug: z.string().min(1),
  rulePackVersion: z.number().int(),
});
export type PermitChecklistItem = z.infer<typeof PermitChecklistItemSchema>;

/**
 * `GET /projects/:id/permits-checklist` — every permit rule in force for the
 * project's jurisdiction chain and business type, as of today.
 *
 * `isExhaustive` is `false` and can only ever be `false` (a `z.literal`, not a
 * boolean, so no future change can make it true by accident). It is not
 * decoration: Ley 176-07 Art. 16 — cited on the municipal-licence item itself
 * — says in law that a licence from one public body never exempts its holder
 * from the others, and several real requirements were deliberately left
 * unseeded because no primary text could be verified for them (see the header
 * of packages/db/migrations/1785560000000_seed-permits-content.sql). A client
 * MUST render `disclaimerEs` as visible copy, never behind a tooltip, and must
 * never present the list as a completeness or compliance check.
 *
 * `items` is legitimately a short list, and an item's absence is never
 * evidence that a permit does not apply.
 */
export const PermitChecklistSchema = z.object({
  items: z.array(PermitChecklistItemSchema),
  /** The project's own jurisdiction — the most specific one in the chain the rules were resolved against. */
  jurisdictionSlug: z.string().min(1),
  jurisdictionName: z.string().min(1),
  /** The fact the conditional (food-handling) rules were evaluated against. */
  businessTypeSlug: z.string().min(1),
  /** The date the rule packs' validity window was evaluated at (YYYY-MM-DD). */
  asOfDate: z.string(),
  isExhaustive: z.literal(false),
  disclaimerEs: z.string().min(1),
});
export type PermitChecklist = z.infer<typeof PermitChecklistSchema>;
