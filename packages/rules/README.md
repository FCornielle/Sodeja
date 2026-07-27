# `@sodeja/rules` — Rule Pack Interpreter

**Status: placeholder. No implementation.**

Evaluates the declarative rule content stored in `rule_pack` / `rule` /
`parameter_value` (see [`specs/db/schema.sql`](../../specs/db/schema.sql)).
Modules 12 (permits) and, in Phase 2, 11 (tax directory) are driven entirely by
this interpreter reading content — never by branching code.

## The governing constraint

**A rate change or a permit-requirement change must be a content edit, never a
deploy.** DGII and the municipalities change things on their own schedule. A
product whose tax answers require an app-store release is broken by
construction, and staleness is the actual mechanism by which risks L2 and L3
cause harm (risk T3).

## Design

- **Declarative, non-Turing-complete conditions.** JSONLogic or a small
  constrained DSL. Two reasons, both load-bearing: a content editor who is not
  an engineer must be able to author rules, and a malformed rule must not be
  able to hang or crash the API. No `eval`, no dynamic code loading, ever.
- **Resolution is date- and jurisdiction-aware.** Every evaluation takes an
  `asOfDate` and a jurisdiction, and resolves up the hierarchy
  (municipio → province → national) so a municipal rule can override a national
  default without duplicating the national content.
- **Citation is mandatory, not decorative.** The interpreter returns the
  citation and effective date alongside every result, because the UI is required
  to render them. A rule that cannot be sourced cannot be published.
- **Deterministic and pure**, like `@sodeja/calc` — the interpreter is handed
  resolved content, it does not query for it.

## What this package must never do

- Return a "compliant" verdict. Module 12 is a **non-exhaustive checklist** by
  design (risk L3). The output vocabulary is "required / likely required /
  not applicable / unknown" — there is no affordance that tells a user they are
  cleared to open.
- Compute a tax liability. Module 11 is an information directory, not an advisor
  (risk L2, reported Ley 633 reservation to licensed CPAs).

## Related backlog items

B-10 (rule-pack infrastructure), B-18 (permits checklist),
B-23 (admin CMS), B-25 (tax directory).
