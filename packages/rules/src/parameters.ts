import type { ResolvedParameter } from "@sodeja/schemas";
import { toCitation } from "./citation.js";
import type { BusinessType, CitationRow, Jurisdiction, ParameterTable, ParameterValue } from "./types.js";

export interface ResolveParameterValueInput {
  parameterTable: ParameterTable;
  /** All values belonging to this parameter table (any jurisdiction/business type/date). */
  parameterValues: readonly ParameterValue[];
  citationsById: ReadonlyMap<number, CitationRow>;
  asOfDate: string;
  businessType?: BusinessType;
  /** Most-specific-first, as returned by resolveJurisdictionChain. Omit to resolve jurisdiction-agnostic values only. */
  jurisdictionChain?: readonly Jurisdiction[];
}

function isValueInForce(value: ParameterValue, asOfDate: string): boolean {
  if (value.validFrom > asOfDate) return false;
  if (value.validTo !== null && value.validTo <= asOfDate) return false;
  return true;
}

/**
 * Resolves the single best-matching `content.parameter_value` row for a
 * parameter table, given an optional business type and jurisdiction, as of a
 * date — this is the read path `@sodeja/calc` depends on for every rate it is
 * handed (README: "There are no numeric literals with business meaning in
 * this package" applies to calc; this is where those numbers actually come
 * from).
 *
 * Candidates are ranked by specificity, most specific wins:
 *   1. business type: exact match beats "applies to all" (NULL)
 *   2. jurisdiction: closer in the chain beats "applies to all" (NULL)
 *   3. validFrom: most recent wins on remaining ties
 *
 * Returns null if nothing is in force — callers must treat that as "we do not
 * know", never fall back to a guess (risk D1).
 *
 * Pure: takes fully-fetched rows, performs no I/O.
 */
export function resolveParameterValue(input: ResolveParameterValueInput): ResolvedParameter | null {
  const { parameterTable, parameterValues, citationsById, asOfDate, businessType, jurisdictionChain } =
    input;

  const jurisdictionRank = new Map<number, number>(
    (jurisdictionChain ?? []).map((j, index) => [j.id, index] as const),
  );

  let best: ParameterValue | undefined;
  let bestBusinessRank = Number.POSITIVE_INFINITY; // 0 = exact match, 1 = applies-to-all
  let bestJurisdictionRank = Number.POSITIVE_INFINITY;

  for (const value of parameterValues) {
    if (value.parameterTableId !== parameterTable.id) continue;
    if (!isValueInForce(value, asOfDate)) continue;

    let businessRank: number;
    if (value.businessTypeId === null) {
      businessRank = 1;
    } else if (businessType && value.businessTypeId === businessType.id) {
      businessRank = 0;
    } else {
      continue; // tied to a different business type than the one requested
    }

    let jurisdictionValueRank: number;
    if (value.jurisdictionId === null) {
      jurisdictionValueRank = jurisdictionRank.size; // least specific: "applies to all"
    } else {
      const rank = jurisdictionRank.get(value.jurisdictionId);
      if (rank === undefined) continue; // tied to a jurisdiction outside the requested chain
      jurisdictionValueRank = rank;
    }

    const better =
      businessRank < bestBusinessRank ||
      (businessRank === bestBusinessRank &&
        (jurisdictionValueRank < bestJurisdictionRank ||
          (jurisdictionValueRank === bestJurisdictionRank &&
            (!best || value.validFrom > best.validFrom))));

    if (better) {
      best = value;
      bestBusinessRank = businessRank;
      bestJurisdictionRank = jurisdictionValueRank;
    }
  }

  if (!best) return null;

  const citationRow = citationsById.get(best.citationId);
  if (!citationRow) {
    throw new Error(
      `parameter_value ${best.id} references citation ${best.citationId}, which was not provided`,
    );
  }

  const jurisdictionSlug =
    best.jurisdictionId === null
      ? undefined
      : jurisdictionChain?.find((j) => j.id === best.jurisdictionId)?.slug;

  return {
    parameterTableSlug: parameterTable.slug,
    ...(businessType && best.businessTypeId === businessType.id
      ? { businessTypeSlug: businessType.slug }
      : {}),
    ...(jurisdictionSlug ? { jurisdictionSlug } : {}),
    valueLow: best.valueLow,
    valueBase: best.valueBase,
    valueHigh: best.valueHigh,
    currency: best.currency,
    citation: toCitation(citationRow),
    provenance: best.provenance,
    validFrom: `${best.validFrom}T00:00:00.000Z`,
    ...(best.validTo ? { validTo: `${best.validTo}T00:00:00.000Z` } : {}),
  };
}
