# `@sodeja/calc` — Capacity & Financial Engine

**Status: B-16 implemented (primitives), plus B-13's layout allocation
(`layout.ts`).** This package currently
implements the *engine substrate* — Money/MoneyRange arithmetic, the Range
combinator layer, and the engine versioning/snapshot mechanism. It
deliberately does **not** yet implement capacity ratios, fit-out cost
formulas, opex/payroll math, or break-even/financial-projection logic —
those are Modules 6, 7, 9, 10 and consume this engine in later backlog items
(B-12, B-14, B-15, B-17), not this one.

The single source of truth for every number SODEJA displays. Modules 6, 7, 9,
and 10 are all this package. It is the product's highest-integrity component:
users may present its output to a lender.

## Non-negotiable properties

**Pure.** No I/O, no network, no database access, no filesystem, no clock, no
randomness, no environment reads. Every input is an explicit argument —
including `asOfDate` and FX rates. This is what lets the same artifact run in
the API, the browser, the React Native runtime, and the PDF worker.

**Versioned and immutable.** Every stored projection records `engineVersion`
(`src/version.ts`, currently `"1.0.0"`) plus a complete snapshot of its
inputs, produced by `snapshot()`. The returned envelope — and everything
reachable from it — is deep-frozen and deep-cloned away from the caller's
original objects, so a report generated in March regenerates identically in
November after the engine has improved. History is never silently recomputed
with a newer engine.

**Rate-free.** The engine knows *how* to compute, never *what the current
rate is*. There are no numeric literals with business meaning anywhere in
this package. Every rate/ratio a caller needs arrives as a `ResolvedParameter`
(defined in `@sodeja/schemas`, produced by `@sodeja/rules`'s
`resolveParameterValue` — see "The B-10 coupling" below) and is converted into
this engine's own `Range<Money>` / `Range<number>` shape by
`parameterInput.ts`, the one deliberate seam between the two packages.

**Dual-currency.** Every monetary value is `{amount, currency}` (`Money`, from
`@sodeja/schemas`) with an explicit FX assumption supplied at the call site
(`money.ts`'s `FxRate`/`convertMoney`). DR commercial leases are frequently
quoted in USD while revenue and payroll are DOP. There is no implicit or
fetched rate anywhere in this package.

**Range-valued — where a range is what the quantity actually is.** Outputs are
`{pessimistic, base, optimistic}`
(`range.ts`'s `Range<T>`), never point estimates. A single confident-looking
number is the mechanism by which risk D1 does its damage. `mapRange` and
`combineRange` verify — not just assume — that the invariant
`pessimistic <= base <= optimistic` still holds after every transform, and
throw `RangeInvariantViolationError` rather than silently returning a
corrupted range if the caller's function was not monotonic non-decreasing
(see the doc comments in `range.ts` for what that means for something like
subtracting a cost range from a revenue range — that inversion is
domain-specific and is left to the modules that actually implement financial
logic). The one deliberate exception is `layout.ts`'s zone allocation: a share
the user typed in is one number they chose, not a three-point estimate, and
wrapping it in a `Range` would manufacture a spread the user never expressed.
The *cited* density it is compared against is three-point and stays a
`Range<number>` end to end.

## The B-10 coupling

`@sodeja/rules`' `resolveParameterValue` and this engine's parameter input are
the same type, `ResolvedParameter`, defined once in `@sodeja/schemas`:

```ts
{
  parameterTableSlug: string;
  businessTypeSlug?: string; jurisdictionSlug?: string;
  valueLow: number; valueBase: number; valueHigh: number;
  currency: "DOP" | "USD" | null;   // null for unitless ratios
  citation: Citation;                // always present, always verified
  provenance: "usuario" | "referencia_sectorial" | "estimado";
  validFrom: string; validTo?: string;
}
```

`parameterInput.ts`'s `parameterToMoneyRange` / `parameterToNumericRange` are
the only place that shape becomes this package's own `Range<Money>` /
`Range<number>` — no translation layer beyond that single, tested function.

## Testing posture

- **Property-based tests on invariants** (`fast-check`) — `pessimistic <=
  base <= optimistic` holds under every combinator tried, Money addition is
  associative and add/subtract round-trips exactly within the engine's
  4-decimal rounding (matching `specs/db/schema.sql`'s `numeric(18,4)` money
  domain), and a snapshot's inputs/result round-trip exactly through JSON.
- **Golden-file regression tests** (`golden.test.ts` +
  `__fixtures__/golden-v<ENGINE_VERSION>.json`) — a frozen input/output
  fixture exercising only the primitive layer (FX conversion, range addition,
  a scalar multiply, wrapped in a snapshot), so an unintended numeric change
  fails CI loudly (risk T6). A new fixture file is added per `ENGINE_VERSION`
  bump; old fixtures are never edited in place, mirroring `content.rule_pack`'s
  append-only discipline.
- If the Flutter path is chosen, these same fixtures become the cross-language
  conformance suite.

## Related backlog items

B-16 (this package), B-12, B-14, B-15, B-17 (the product modules that consume
it).
