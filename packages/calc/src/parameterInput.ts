import type { Money, ResolvedParameter } from "@sodeja/schemas";
import { numberCompare, type Range } from "./range.js";
import { moneyCompare } from "./money.js";

/**
 * The actual coupling between B-10 (`@sodeja/rules`) and B-16 (this
 * package): `ResolvedParameter` is defined once, in `@sodeja/schemas`, so
 * `@sodeja/rules`' `resolveParameterValue` output and this engine's rate/ratio
 * input are the same type with no translation layer. These two functions are
 * the only place that shape is turned into this package's own `Range<T>`
 * primitive.
 *
 * The engine never reads a numeric literal with business meaning out of its
 * own code (SODEJA_ARCHITECTURE.md "@sodeja/calc") — every rate/ratio it
 * uses arrives as a `ResolvedParameter`, converted here.
 */

export class UnitlessParameterError extends Error {
  constructor(slug: string) {
    super(
      `Parameter "${slug}" is unitless (currency = null) — use parameterToNumericRange, not ` +
        "parameterToMoneyRange.",
    );
    this.name = "UnitlessParameterError";
  }
}

/** For a currency-bearing parameter (a rate, a ceiling, a wage floor). */
export function parameterToMoneyRange(param: ResolvedParameter): Range<Money> {
  if (!param.currency) {
    throw new UnitlessParameterError(param.parameterTableSlug);
  }
  const currency = param.currency;
  const range: Range<Money> = {
    pessimistic: { amount: param.valueLow, currency },
    base: { amount: param.valueBase, currency },
    optimistic: { amount: param.valueHigh, currency },
  };
  // Defensive re-check: ResolvedParameterSchema already enforces this on the
  // rules side, but this function does not assume its caller validated first.
  if (moneyCompare(range.pessimistic, range.base) > 0 || moneyCompare(range.base, range.optimistic) > 0) {
    throw new Error(`Parameter "${param.parameterTableSlug}" violates low <= base <= high`);
  }
  return range;
}

/** For a unitless parameter (a capacity ratio, an area share, a percentage stored as a bare number). */
export function parameterToNumericRange(param: ResolvedParameter): Range<number> {
  const range: Range<number> = {
    pessimistic: param.valueLow,
    base: param.valueBase,
    optimistic: param.valueHigh,
  };
  if (numberCompare(range.pessimistic, range.base) > 0 || numberCompare(range.base, range.optimistic) > 0) {
    throw new Error(`Parameter "${param.parameterTableSlug}" violates low <= base <= high`);
  }
  return range;
}
