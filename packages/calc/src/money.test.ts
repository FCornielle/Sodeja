import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addMoney,
  addMoneyRange,
  convertMoney,
  convertMoneyRange,
  CurrencyMismatchError,
  makeMoney,
  moneyCompare,
  multiplyMoney,
  multiplyMoneyRange,
  subtractMoney,
  sumMoney,
} from "./money.js";
import type { Range } from "./range.js";

describe("addMoney / subtractMoney", () => {
  it("adds two amounts in the same currency", () => {
    expect(addMoney({ amount: 100, currency: "DOP" }, { amount: 50, currency: "DOP" })).toEqual({
      amount: 150,
      currency: "DOP",
    });
  });

  it("throws CurrencyMismatchError rather than silently mixing currencies", () => {
    expect(() => addMoney({ amount: 100, currency: "DOP" }, { amount: 50, currency: "USD" })).toThrow(
      CurrencyMismatchError,
    );
  });

  it("subtracts within a currency", () => {
    expect(subtractMoney({ amount: 100, currency: "DOP" }, { amount: 30, currency: "DOP" })).toEqual({
      amount: 70,
      currency: "DOP",
    });
  });
});

describe("multiplyMoney", () => {
  it("scales an amount by a scalar factor", () => {
    expect(multiplyMoney({ amount: 100, currency: "DOP" }, 1.5)).toEqual({
      amount: 150,
      currency: "DOP",
    });
  });
});

describe("sumMoney", () => {
  it("sums a list via repeated addMoney", () => {
    const values = [
      { amount: 10, currency: "DOP" as const },
      { amount: 20, currency: "DOP" as const },
      { amount: 30, currency: "DOP" as const },
    ];
    expect(sumMoney(values)).toEqual({ amount: 60, currency: "DOP" });
  });

  it("throws on an empty list rather than returning a fabricated zero", () => {
    expect(() => sumMoney([])).toThrow();
  });
});

describe("convertMoney", () => {
  it("requires an explicit FX rate, never an implicit one", () => {
    const converted = convertMoney({ amount: 100, currency: "USD" }, { from: "USD", to: "DOP", rate: 60 });
    expect(converted).toEqual({ amount: 6000, currency: "DOP" });
  });

  it("rejects a rate quoted from the wrong currency", () => {
    expect(() =>
      convertMoney({ amount: 100, currency: "DOP" }, { from: "USD", to: "DOP", rate: 60 }),
    ).toThrow();
  });

  it("rejects a non-positive rate", () => {
    expect(() =>
      convertMoney({ amount: 100, currency: "USD" }, { from: "USD", to: "DOP", rate: 0 }),
    ).toThrow();
  });

  it("is a no-op when from and to are the same currency", () => {
    expect(convertMoney({ amount: 100, currency: "DOP" }, { from: "DOP", to: "DOP", rate: 1 })).toEqual({
      amount: 100,
      currency: "DOP",
    });
  });
});

function moneyRange(pessimistic: number, base: number, optimistic: number, currency: "DOP" | "USD" = "DOP"): Range<import("@sodeja/schemas").Money> {
  return {
    pessimistic: { amount: pessimistic, currency },
    base: { amount: base, currency },
    optimistic: { amount: optimistic, currency },
  };
}

describe("addMoneyRange / multiplyMoneyRange / convertMoneyRange", () => {
  it("adds two MoneyRanges bound-for-bound", () => {
    const a = moneyRange(10, 20, 30);
    const b = moneyRange(1, 2, 3);
    expect(addMoneyRange(a, b)).toEqual(moneyRange(11, 22, 33));
  });

  it("scales a MoneyRange by a non-negative factor", () => {
    expect(multiplyMoneyRange(moneyRange(10, 20, 30), 2)).toEqual(moneyRange(20, 40, 60));
  });

  it("rejects a negative factor rather than silently reversing bound order", () => {
    expect(() => multiplyMoneyRange(moneyRange(10, 20, 30), -1)).toThrow();
  });

  it("converts every bound of a MoneyRange with one explicit FX rate", () => {
    const range = moneyRange(10, 20, 30, "USD");
    const converted = convertMoneyRange(range, { from: "USD", to: "DOP", rate: 60 });
    expect(converted).toEqual(moneyRange(600, 1200, 1800, "DOP"));
  });
});

describe("property: Money arithmetic is associative and loses no precision within numeric(18,4)", () => {
  const cents = fc.integer({ min: -1_000_000_00, max: 1_000_000_00 }); // in hundredths, i.e. up to +/-1,000,000.00

  it("(a + b) + c === a + (b + c) up to the engine's 4-decimal rounding", () => {
    fc.assert(
      fc.property(cents, cents, cents, (ac, bc, cc) => {
        const a = makeMoney(ac / 100, "DOP");
        const b = makeMoney(bc / 100, "DOP");
        const c = makeMoney(cc / 100, "DOP");
        const left = addMoney(addMoney(a, b), c);
        const right = addMoney(a, addMoney(b, c));
        expect(left).toEqual(right);
      }),
    );
  });

  it("addMoney followed by subtractMoney of the same value returns the original amount", () => {
    fc.assert(
      fc.property(cents, cents, (ac, bc) => {
        const a = makeMoney(ac / 100, "DOP");
        const b = makeMoney(bc / 100, "DOP");
        expect(subtractMoney(addMoney(a, b), b)).toEqual(a);
      }),
    );
  });

  it("a MoneyRange combined via addMoneyRange never has pessimistic > base or base > optimistic", () => {
    const orderedCents = fc
      .tuple(cents, fc.nat(1_000_00), fc.nat(1_000_00))
      .map(([p, d1, d2]) => [p, p + d1, p + d1 + d2] as const);

    fc.assert(
      fc.property(orderedCents, orderedCents, ([p1, b1, o1], [p2, b2, o2]) => {
        const a = moneyRange(p1 / 100, b1 / 100, o1 / 100);
        const b = moneyRange(p2 / 100, b2 / 100, o2 / 100);
        const result = addMoneyRange(a, b);
        expect(moneyCompare(result.pessimistic, result.base)).toBeLessThanOrEqual(0);
        expect(moneyCompare(result.base, result.optimistic)).toBeLessThanOrEqual(0);
      }),
    );
  });
});
