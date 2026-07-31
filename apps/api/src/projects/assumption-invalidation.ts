import type { ParameterTable } from "@sodeja/rules";
import type { EstimateType } from "@sodeja/schemas";

/**
 * B-11a's static recompute-dependency graph: which `app.*` calculation-output
 * tables (specs/db/schema.sql "Calculation outputs (Modules 6, 9, 10, 7)")
 * become potentially stale when an assumption sourced from a
 * `content.parameter_table` of a given `domain` is overridden.
 *
 * Deliberately NOT "invalidate everything on every change": a
 * `domain='capacity'` assumption must not claim to invalidate
 * `fitout_estimate`. Also deliberately NOT a general dependency-graph engine
 * — a flat map is sufficient for the 4 estimate types that exist in Phase 1
 * (docs/SODEJA_MVP_BACKLOG.md Phase 0 refinements item 3).
 *
 * `financial_projection` is the integration point (B-17's four hard
 * dependencies: B-11/B-12/B-14/B-15 all feed it — see
 * docs/SODEJA_MVP_BACKLOG.md "Corrected dependency" section), so every
 * domain that can reach ANY estimate also invalidates it.
 */
const DOMAIN_INVALIDATES: Record<ParameterTable["domain"], readonly EstimateType[]> = {
  capacity: ["capacity_estimate", "financial_projection"],
  construction: ["fitout_estimate", "financial_projection"],
  layout: ["fitout_estimate", "financial_projection"],
  labor: ["opex_estimate", "financial_projection"],
  rent: ["opex_estimate", "financial_projection"],
  utilities: ["opex_estimate", "financial_projection"],
  tax: ["financial_projection"],
};

/**
 * Conservative fallback for an assumption with no `default_parameter_value_id`
 * (e.g. a hand-added assumption not sourced from any `parameter_table` —
 * not something B-11a currently creates, but the column is nullable in the
 * schema so a future write path could produce one). Flags only the
 * integration point rather than guessing a domain, and rather than
 * invalidating every estimate type.
 */
const UNKNOWN_DOMAIN_FALLBACK: readonly EstimateType[] = ["financial_projection"];

export function estimatesInvalidatedByDomain(domain: ParameterTable["domain"] | null): EstimateType[] {
  if (domain === null) return [...UNKNOWN_DOMAIN_FALLBACK];
  return [...DOMAIN_INVALIDATES[domain]];
}
