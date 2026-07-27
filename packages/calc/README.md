# `@sodeja/calc` — Capacity & Financial Engine

**Status: placeholder. No implementation.**

The single source of truth for every number SODEJA displays. Modules 6, 7, 9,
and 10 are all this package. It is the product's highest-integrity component:
users may present its output to a lender.

## Non-negotiable properties

**Pure.** No I/O, no network, no database access, no filesystem, no clock, no
randomness, no environment reads. Every input is an explicit argument —
including `asOfDate` and FX rates. This is what lets the same artifact run in
the API, the browser, the React Native runtime, and the PDF worker.

**Versioned and immutable.** Every stored projection records `engine_version`
plus a complete snapshot of its inputs. A report generated in March must
regenerate identically in November after the engine has improved. History is
never silently recomputed with a newer engine.

**Rate-free.** The engine knows *how* to compute, never *what the current rate
is*. ITBIS, ISR brackets, TSS ceilings, minimum wages, capacity ratios, fit-out
uplifts — all arrive as injected parameters from `parameter_value` rows
(see [`specs/db/schema.sql`](../../specs/db/schema.sql)). There are no numeric
literals with business meaning in this package.

**Dual-currency.** Every monetary value is `{amount, currency}` with an explicit
FX assumption on the scenario. DR commercial leases are frequently quoted in USD
while revenue and payroll are DOP. Retrofitting currency into a finance engine
is brutal; this is designed in from commit one.

**Range-valued.** Outputs are `{pessimistic, base, optimistic}`, never point
estimates. A single confident-looking number is the mechanism by which risk D1
does its damage.

## Testing posture

- **Property-based tests on invariants** — e.g. closing cash equals opening cash
  plus inflows minus outflows; the sum of monthly figures equals the annual
  figure; a pessimistic bound never exceeds its optimistic bound.
- **Golden-file regression tests** — frozen input/output fixtures per engine
  version, so an unintended numeric change fails CI loudly (risk T6).
- If the Flutter path is chosen, these same fixtures become the cross-language
  conformance suite.

## Related backlog items

B-16 (the engine), B-12, B-14, B-15, B-17.
