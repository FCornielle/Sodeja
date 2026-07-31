import type { Currency, Money } from "@sodeja/schemas";
import { combineRange, mapRange, type Range } from "./range.js";

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(
      `Cannot combine amounts in different currencies (${a} vs ${b}) without an explicit FX rate — ` +
        "see convertMoney. This engine never assumes an implicit rate.",
    );
    this.name = "CurrencyMismatchError";
  }
}

// Matches specs/db/schema.sql's content.money_amount domain (numeric(18,4)):
// binary floating point is never persisted or displayed beyond 4 decimal
// places, so the engine rounds to the same precision at every step rather
// than accumulating float noise that only surfaces when a number is stored.
function round4(amount: number): number {
  return Math.round(amount * 10000) / 10000;
}

export function makeMoney(amount: number, currency: Currency): Money {
  if (!Number.isFinite(amount)) throw new Error("Money amount must be finite");
  return { amount: round4(amount), currency };
}

/** Ascending comparator for two `Money` values of the SAME currency. Throws on a currency mismatch — there is no meaningful order across currencies without an FX rate. */
export function moneyCompare(a: Money, b: Money): number {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return a.amount - b.amount;
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return makeMoney(a.amount + b.amount, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return makeMoney(a.amount - b.amount, a.currency);
}

export function multiplyMoney(a: Money, factor: number): Money {
  if (!Number.isFinite(factor)) throw new Error("multiplyMoney factor must be finite");
  return makeMoney(a.amount * factor, a.currency);
}

/** Sums a non-empty list of same-currency Money values. Built from addMoney, not a new primitive. */
export function sumMoney(values: readonly Money[]): Money {
  if (values.length === 0) throw new Error("sumMoney requires at least one value");
  const [first, ...rest] = values as [Money, ...Money[]];
  return rest.reduce(addMoney, first);
}

export interface FxRate {
  from: Currency;
  to: Currency;
  /** Units of `to` per 1 unit of `from`. Always an explicit input — DR leases are frequently USD while payroll/revenue are DOP (SODEJA_ARCHITECTURE.md); the engine never fetches or hardcodes a rate. */
  rate: number;
}

export function convertMoney(money: Money, fx: FxRate): Money {
  if (money.currency !== fx.from) {
    throw new Error(`FX rate is quoted from ${fx.from} but the money supplied is in ${money.currency}`);
  }
  if (!Number.isFinite(fx.rate) || fx.rate <= 0) {
    throw new Error("FX rate must be a positive, finite number");
  }
  if (fx.from === fx.to) return { ...money };
  return makeMoney(money.amount * fx.rate, fx.to);
}

// --- MoneyRange: the Range<T> combinators specialized to Money ---

export function mapMoneyRange(range: Range<Money>, fn: (m: Money) => Money): Range<Money> {
  return mapRange(range, fn, moneyCompare);
}

export function combineMoneyRange(
  a: Range<Money>,
  b: Range<Money>,
  fn: (x: Money, y: Money) => Money,
): Range<Money> {
  return combineRange(a, b, fn, moneyCompare);
}

export function addMoneyRange(a: Range<Money>, b: Range<Money>): Range<Money> {
  return combineMoneyRange(a, b, addMoney);
}

export function multiplyMoneyRange(range: Range<Money>, factor: number): Range<Money> {
  if (factor < 0) {
    throw new Error(
      "multiplyMoneyRange requires a non-negative factor — a negative factor reverses bound order, " +
        "which this primitive does not attempt to re-sort for you.",
    );
  }
  return mapMoneyRange(range, (m) => multiplyMoney(m, factor));
}

export function convertMoneyRange(range: Range<Money>, fx: FxRate): Range<Money> {
  return mapMoneyRange(range, (m) => convertMoney(m, fx));
}
