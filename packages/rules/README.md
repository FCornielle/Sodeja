# `@sodeja/rules` — Rule Pack Interpreter

**Status: B-10 implemented.** Evaluates the declarative rule content stored
in `rule_pack` / `rule` / `parameter_value` (see
[`specs/db/schema.sql`](../../specs/db/schema.sql)). Modules 12 (permits) and,
in Phase 2, 11 (tax directory) are driven entirely by this interpreter reading
content — never by branching code. This package does **not** seed any permit
(`rule_pack`/`rule`) content itself — MOPC's R-007 scope of application is
still unread/unconfirmed (SODEJA_RISKS.md addendum), so that content is
explicitly B-18's job, not B-10's. What this package seeds is a narrow set of
`parameter_value` figures the Data Sources doc marks "VERIFIED exactly" (see
the migration for the full list and what was deliberately left out).

## The governing constraint

**A rate change or a permit-requirement change must be a content edit, never
a deploy.** DGII and the municipalities change things on their own schedule. A
product whose tax answers require an app-store release is broken by
construction, and staleness is the actual mechanism by which risks L2 and L3
cause harm (risk T3).

## Why JSONLogic, and why `json-logic-js` specifically

Two non-negotiable constraints ruled out a hand-rolled DSL: a content editor
who is not an engineer must be able to author rules (a future admin CMS,
B-23), and a malformed rule must not be able to hang or crash the API.
[JSONLogic](https://jsonlogic.com) is a small, well-established, JSON-native
condition language with exactly the vocabulary a permit/tax rule needs
(comparisons, boolean combinators, arithmetic, `var` lookups) and nothing a
Turing-complete language has (no loops, no function definitions, no I/O).

Between the two established Node implementations:

- **`json-logic-js`** (the reference implementation, by the author of
  jsonlogic.com) — a pure, zero-dependency, tree-walking interpreter. It never
  constructs a `Function`, never calls `eval`, and has no code-generation path
  at all; it just recursively walks the parsed JSON and dispatches to a fixed
  table of operators.
- **`json-logic-engine`** — materially faster (its README advertises
  10–25x), achieved by *compiling* rules into JIT-generated JS via the
  `Function` constructor on its default `build()` path.

That performance gain is not a trade this package needs: rules are evaluated
a handful of times per user request, not in a hot loop, and this package's
non-negotiable is "no eval, no dynamic code loading, ever" (see below) — a
constraint about what class of vulnerability is possible against
content, not about interpreter throughput. `json-logic-js`'s pure-interpreter
design makes "a malformed rule cannot execute arbitrary code" true by
construction rather than by discipline, so it was chosen over the faster
alternative. `evaluateCondition` (`src/jsonLogic.ts`) is the single seam into
that library, and additionally bounds condition nesting depth before handing
anything to it, so pathological content fails fast with a
`RuleEvaluationError` instead of a stack overflow.

## Design

- **Declarative, non-Turing-complete conditions.** JSONLogic, evaluated by
  `evaluateCondition`. No `eval`, no dynamic code loading, ever. A rule that
  fails to evaluate is isolated into a `failures` array — it never crashes the
  overall evaluation and never silently produces a wrong verdict.
- **Resolution is date- and jurisdiction-aware.** `resolveJurisdictionChain`
  walks `content.jurisdiction`'s hierarchy (municipio → provincia → nacional),
  most specific first. `evaluatePermitRules` and `resolveParameterValue` both
  take that chain and let a more specific jurisdiction's rule/value silently
  override a broader one sharing the same `code` (rules) or table (parameter
  values) — a municipal rule never needs to duplicate the national default it
  overrides.
- **Citation is mandatory, not decorative.** Every `PermitRuleResult` and
  every `ResolvedParameter` carries a fully-formed `Citation` (from
  `@sodeja/schemas`) and effective date. `toCitation` refuses to emit a
  citation row whose `is_verified` flag is false — an unsourced or
  unconfirmed figure cannot reach a result the UI renders (risk T3).
- **Deterministic and pure at the core.** `jurisdiction.ts`, `jsonLogic.ts`,
  `permits.ts`, `parameters.ts`, and `citation.ts` take already-fetched
  content and perform no I/O — the interpreter is handed resolved content, it
  does not query for it. `repository.ts` (thin SQL against `@sodeja/db`) and
  `evaluate.ts` (orchestration) are the only two files that touch a database.

## What this package must never do

- Return a "compliant" verdict. Module 12 is a **non-exhaustive checklist** by
  design (risk L3). The output vocabulary is `required` / `likely_required` /
  `not_applicable` / `unknown` — there is no affordance that tells a user they
  are cleared to open. This is enforced by the TS union type
  (`PermitRuleResult["requirement"]`), and a `null` `requirement` column is
  mapped to `'unknown'` rather than crashing or being silently omitted.
- Compute a tax liability. Module 11 is an information directory, not an
  advisor (risk L2, reported Ley 633 reservation to licensed CPAs). Nothing
  in this package sums, multiplies, or otherwise derives a liability figure —
  it resolves rates and evaluates conditions, nothing more.

## The B-10 / B-16 contract

`resolveParameterValue` (and its DB-backed wrapper `resolveParameter`) return
`ResolvedParameter`, defined once in `@sodeja/schemas` (`primitives.ts`) so
`@sodeja/calc` can depend on the same type without depending on this package
or on `@sodeja/db`:

```ts
{
  parameterTableSlug: string;
  businessTypeSlug?: string;
  jurisdictionSlug?: string;
  valueLow: number; valueBase: number; valueHigh: number; // never a point estimate
  currency: "DOP" | "USD" | null; // null for unitless ratios
  citation: Citation;   // always present, always verified
  provenance: "usuario" | "referencia_sectorial" | "estimado";
  validFrom: string; validTo?: string; // ISO datetime
}
```

## Related backlog items

B-10 (rule-pack infrastructure, this package), B-16 (`@sodeja/calc`, the
consumer of `ResolvedParameter`), B-18 (permits checklist — seeds the actual
`rule_pack`/`rule` content this package interprets), B-23 (admin CMS), B-25
(tax directory).
