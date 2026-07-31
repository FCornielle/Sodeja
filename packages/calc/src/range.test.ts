import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { combineRange, makeRange, mapRange, numberCompare, RangeInvariantViolationError } from "./range.js";

describe("makeRange", () => {
  it("accepts an ordered triple", () => {
    expect(makeRange(1, 2, 3, numberCompare)).toEqual({ pessimistic: 1, base: 2, optimistic: 3 });
  });

  it("rejects pessimistic > base", () => {
    expect(() => makeRange(5, 2, 3, numberCompare)).toThrow(RangeInvariantViolationError);
  });

  it("rejects base > optimistic", () => {
    expect(() => makeRange(1, 5, 3, numberCompare)).toThrow(RangeInvariantViolationError);
  });
});

describe("mapRange", () => {
  it("applies a monotonic function to every bound", () => {
    const range = makeRange(1, 2, 3, numberCompare);
    const doubled = mapRange(range, (n) => n * 2, numberCompare);
    expect(doubled).toEqual({ pessimistic: 2, base: 4, optimistic: 6 });
  });

  it("throws rather than silently corrupt the invariant when fn is not monotonic", () => {
    const range = makeRange(1, 2, 3, numberCompare);
    expect(() => mapRange(range, (n) => -n, numberCompare)).toThrow(RangeInvariantViolationError);
  });
});

describe("combineRange", () => {
  it("combines two ranges bound-for-bound with a monotonic function", () => {
    const a = makeRange(1, 2, 3, numberCompare);
    const b = makeRange(10, 20, 30, numberCompare);
    const sum = combineRange(a, b, (x, y) => x + y, numberCompare);
    expect(sum).toEqual({ pessimistic: 11, base: 22, optimistic: 33 });
  });

  it("throws rather than silently corrupt the invariant when fn is not monotonic in both args", () => {
    const a = makeRange(1, 2, 3, numberCompare);
    const b = makeRange(10, 20, 30, numberCompare);
    // subtraction is decreasing in its second argument, so pairing
    // pessimistic-with-pessimistic here does NOT produce the pessimistic
    // difference — exactly the misuse this primitive guards against.
    expect(() => combineRange(a, b, (x, y) => x - y, numberCompare)).toThrow(
      RangeInvariantViolationError,
    );
  });
});

describe("property: pessimistic <= base <= optimistic under every combinator", () => {
  const orderedTriple = fc
    .tuple(
      fc.double({ noNaN: true, min: -1000, max: 1000 }),
      fc.double({ noNaN: true, min: 0, max: 1000 }),
      fc.double({ noNaN: true, min: 0, max: 1000 }),
    )
    .map(([p, d1, d2]) => ({ pessimistic: p, base: p + d1, optimistic: p + d1 + d2 }));

  it("mapRange preserves the invariant for any non-negative affine transform", () => {
    fc.assert(
      fc.property(
        orderedTriple,
        fc.double({ noNaN: true, min: 0, max: 100 }),
        fc.double({ noNaN: true, min: -1000, max: 1000 }),
        (range, scale, shift) => {
          const result = mapRange(range, (n) => n * scale + shift, numberCompare);
          expect(result.pessimistic).toBeLessThanOrEqual(result.base);
          expect(result.base).toBeLessThanOrEqual(result.optimistic);
        },
      ),
    );
  });

  it("combineRange(add) preserves the invariant for any two valid ranges", () => {
    fc.assert(
      fc.property(orderedTriple, orderedTriple, (a, b) => {
        const result = combineRange(a, b, (x, y) => x + y, numberCompare);
        expect(result.pessimistic).toBeLessThanOrEqual(result.base);
        expect(result.base).toBeLessThanOrEqual(result.optimistic);
      }),
    );
  });
});
