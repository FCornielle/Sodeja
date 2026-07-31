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
