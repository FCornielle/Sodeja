/**
 * The non-monetary, generic counterpart of a three-point value:
 * `{pessimistic, base, optimistic}`. Structurally identical to
 * `@sodeja/schemas`'s `NumericRangeSchema`/`MoneyRangeSchema`-inferred types
 * for `T = number` / `T = Money` respectively — this package does not import
 * those schemas at runtime (no validation dependency needed for pure
 * computation), but a `Range<number>` or `Range<Money>` value produced here
 * satisfies them.
 *
 * Never a point estimate (SODEJA_ARCHITECTURE.md "@sodeja/calc"): a single
 * confident-looking number is the mechanism by which risk D1 does its damage.
 */
export interface Range<T> {
  pessimistic: T;
  base: T;
  optimistic: T;
}

export class RangeInvariantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RangeInvariantViolationError";
  }
}

function assertOrder<T>(range: Range<T>, compare: (a: T, b: T) => number): void {
  if (compare(range.pessimistic, range.base) > 0 || compare(range.base, range.optimistic) > 0) {
    throw new RangeInvariantViolationError(
      "pessimistic must not exceed base, and base must not exceed optimistic. The function passed " +
        "to mapRange/combineRange is not monotonic non-decreasing over this range — for a quantity " +
        "that DECREASES the result (e.g. a cost being subtracted from a revenue range), invert which " +
        "bound of that operand feeds the pessimistic/optimistic side before combining. That inversion " +
        "is domain-specific and deliberately out of scope for this primitive layer.",
    );
  }
}

/** Standard ascending comparator for plain numbers. */
export function numberCompare(a: number, b: number): number {
  return a - b;
}

/** Builds a `Range<T>` from three values and verifies the invariant. */
export function makeRange<T>(
  pessimistic: T,
  base: T,
  optimistic: T,
  compare: (a: T, b: T) => number,
): Range<T> {
  const range: Range<T> = { pessimistic, base, optimistic };
  assertOrder(range, compare);
  return range;
}

/**
 * Applies `fn` to every bound of a range. `fn` must be monotonic
 * non-decreasing (e.g. adding a constant, scaling by a non-negative factor)
 * for the result to satisfy the invariant; if it is not, this throws
 * `RangeInvariantViolationError` rather than silently returning a range with
 * pessimistic > optimistic.
 */
export function mapRange<T, U>(
  range: Range<T>,
  fn: (value: T) => U,
  compare: (a: U, b: U) => number,
): Range<U> {
  const mapped: Range<U> = {
    pessimistic: fn(range.pessimistic),
    base: fn(range.base),
    optimistic: fn(range.optimistic),
  };
  assertOrder(mapped, compare);
  return mapped;
}

/**
 * Combines two ranges bound-for-bound (pessimistic-with-pessimistic,
 * base-with-base, optimistic-with-optimistic) via `fn`, which must be
 * monotonic non-decreasing in both arguments for the invariant to hold. See
 * `RangeInvariantViolationError` for what happens when it is not.
 */
export function combineRange<T, U, V>(
  a: Range<T>,
  b: Range<U>,
  fn: (x: T, y: U) => V,
  compare: (a: V, b: V) => number,
): Range<V> {
  const combined: Range<V> = {
    pessimistic: fn(a.pessimistic, b.pessimistic),
    base: fn(a.base, b.base),
    optimistic: fn(a.optimistic, b.optimistic),
  };
  assertOrder(combined, compare);
  return combined;
}
