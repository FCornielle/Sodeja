# SODEJA — Prioritized MVP Backlog

Status: from planning phase; will be refined once the Phase 0 technical package lands (see task tracking).

## Phase 0 — Foundation & validation (mostly human tasks, not agent-executable)

| ID | Item | Depends on |
|---|---|---|
| P0-1 | Overture Places DR coverage measurement spike | — |
| P0-2 | Unit-economics model (cost per completed analysis) | P0-1 |
| P0-3 | Pricing + buyer validation with ~15 prospective users | — |
| P0-4 | Engage DR contador + lawyer; ToS/license legal reads | — |
| P0-5 | Data-curation workstream stood up, owner named | — |

## Phase 1 — MVP backlog

| ID | Item | Depends on |
|---|---|---|
| B-1 | Monorepo, CI, `@sodeja/schemas` (Zod), error monitoring | — |
| B-2 | Postgres + PostGIS + RLS + Supabase Auth; project aggregate | B-1 |
| B-3 | Provider abstraction layer + server-side proxy + rate caps + billing alerts | B-1 |
| B-4 | Ingest Open Buildings + Microsoft footprints into PostGIS | B-2 |
| B-5 | POI ingestion/query layer (shape determined by P0-1) | B-2, P0-1 |
| B-6 | ONE census + `RD_SECCIONES` ingestion, population aggregation grid | B-2 |
| B-7 | Module 3 — map UI, tap-to-select, area readout, manual polygon-draw fallback | B-3, B-4 |
| B-8 | Module 2 — footprint area + POI use-label + user confirm/override | B-4, B-5, B-7 |
| B-9 | Module 1 — population + competition counts + demand model, with confidence score | B-5, B-6, B-7 |
| B-10 | Rule-pack / parameter-table infrastructure (versioned, dated, cited) | B-2 |
| B-11 | Module 5 — business-type parameter sets, 4-6 types curated | B-10, P0-5 |
| B-12 | Module 6 — capacity ratios, ranges, user-editable | B-11, B-8 |
| B-13 | Module 4 — layout templates from typology ratios | B-11, B-12 |
| B-14 | Module 9 — fit-out cost, construction-index anchor + curated uplifts | B-10, B-11, P0-5 |
| B-15 | Module 10 — opex: payroll/TSS exact, rent + utilities curated | B-10, B-11, P0-5 |
| B-16 | `@sodeja/calc` — pure, versioned, dual-currency, property-tested | B-10 |
| B-17 | Module 7 — financial projection, ranges + scenarios + sensitivity | B-11, B-12, B-14, B-15, B-16 |
| B-18 | Module 12 — permits checklist, DN + Santiago, non-exhaustive framing | B-10, P0-4, P0-5 |
| B-19 | PDF worker + Module 13 summary tier (provenance tags, disclaimer, engine version) | B-9, B-17, B-18 |
| B-20 | Disclaimers, versioned ToS acceptance, Ley 172-13 consent flow, export/delete endpoints | B-2, P0-4 |
| B-21 | Android shell — online-capable companion | B-16, B-7 |
| B-22 | Ground-truth set: 30-50 DR commercial spaces (surveyed area + capacity) | P0-5 |

## Phase 2 backlog

| ID | Item | Depends on |
|---|---|---|
| B-23 | Content admin CMS, draft → review → publish | B-10 |
| B-24 | Module 8 — comparator + proxy traffic index + confidence-tier gating | B-9, B-17, B-23 |
| B-25 | Module 11 — DGII information directory + obligations calendar | B-10, B-23, P0-4 |
| B-26 | Module 13 full business plan | B-19, B-22, B-24, B-25 |
| B-27 | Full Android offline — SQLite, outbox, PMTiles pack | B-21 |
| B-28 | Geographic + sector expansion | B-23, P0-5 |

## Phase 3 backlog

| ID | Item | Depends on |
|---|---|---|
| B-29 | Python geo/ML service; genuine computer-vision refinement | B-4, B-22 |
| B-30 | Usage-derived benchmark datasets (the data moat) | B-17 |

## Critical path

B-10 (rules infrastructure) → B-11 (simulator) → B-12 (capacity) → B-16 (calc engine) → **B-17 (financial projection)** → B-19 (report). B-17 has four hard dependencies — it is the integration point where any upstream slip lands. B-22 (ground truth) gates B-26 and B-29 and takes real calendar time; start during Phase 1, not when it becomes blocking.

---

# Phase 0 refinements

Added 2026-07-25 after writing [`specs/db/schema.sql`](../specs/db/schema.sql),
[`specs/api/openapi.yaml`](../specs/api/openapi.yaml) and
[`specs/ux/flows.md`](../specs/ux/flows.md). Only items whose **scope or
dependencies actually changed** are listed.

## 1. Corrected dependency — B-16 moves earlier (affects the critical path)

The backlog places `@sodeja/calc` (B-16) alongside B-12/B-14/B-15. Writing the
API contract showed this is backwards: capacity (B-12), fit-out (B-14) and opex
(B-15) are not consumers of the engine that happen to run in parallel with it —
**they are engine outputs**. Each returns `engineVersion` + `asOfDate` and each
persists an `inputs_snapshot`. None can be built before the engine's I/O
contract and versioning scheme exist.

**Revised critical path:**

> B-10 (rules/params) → **B-16 (calc engine)** + B-11 (business types) →
> B-12 / B-14 / B-15 → **B-17** → B-19

The engine moves from the middle of the path to near its head. This does not add
work, but it changes what must be staffed first and removes an assumed
parallelism that was never real.

## 2. Corrected dependency — B-19 now hard-depends on B-20

`app.report` carries a database CHECK: a report cannot reach `ready` without a
`disclaimer_document_id`. Legal-document versioning (B-20) therefore blocks the
first export rather than running beside it. Making the disclaimer a schema
constraint instead of application logic means no future code path can bypass it —
but it does mean B-20 cannot slip to the end of Phase 1.

## 3. New item — B-11a: project assumption set

| ID | Item | Depends on |
|---|---|---|
| B-11a | Canonical per-project assumption set: provenance tagging, user overrides, plausibility bands, override instrumentation, downstream staleness/invalidation | B-10, B-11 |

Not represented in the original backlog, and larger than it looks. It is the
single mechanism behind risk T6 (one assumption set, so no two modules disagree
about the same site), risk D1 (provenance and plausibility warnings), and the
PDF assumptions appendix. It also owns the recompute-dependency graph — the
`invalidated[]` array returned when an assumption changes. Every module from
B-12 onward depends on it.

## 4. New item — B-7a: area confirmation gate

| ID | Item | Depends on |
|---|---|---|
| B-7a | Area confirmation gate: dataset area is a suggestion until explicitly confirmed; blocks capacity, projection and export | B-7, B-8 |

Risk T1's mitigation is currently implicit across B-7/B-8. It is actually a
cross-cutting precondition enforced in three places (schema, API `409`
responses, UX step 2) and is worth tracking as its own item so it cannot be
quietly dropped for flow-smoothness reasons late in the phase.

**Cheap win found while specifying it:** `project_location` retains
`suggested_area_sqm` alongside the confirmed `area_sqm`. The delta between them,
collected across real users from launch day, is a continuous accuracy signal —
so B-22's ground-truth work gains a running dataset instead of being the only
source of truth about estimate quality. Does not replace B-22, but it starts
measuring months earlier.

## 5. Scope fork — B-5 and a possible new B-2a, both gated on P0-1

The licence split in the schema (`geo` = storable, `ephemeral` = TTL-bound)
makes the P0-1 outcome a genuine branch rather than a detail:

- **If Overture DR coverage is sufficient:** the `ephemeral` schema is dropped
  entirely. B-5 becomes a straightforward warehouse ingestion, and POI queries
  work offline.
- **If it is not:** B-5 becomes a per-request proxied integration, **and** a new
  item is required —

| ID | Item | Depends on |
|---|---|---|
| B-2a | Retention reaper for `ephemeral` schema: expire coordinates ≤30 days, expire payloads, exclude from backups | B-2, P0-1 |

— plus a permanent per-request cost line in the unit economics (P0-2) and a
permanent offline gap in the Android app. **P0-1 should be sequenced first among
the Phase 0 spikes**; more downstream scope hangs off it than off any other.

## 6. Scope increase — B-10 parameter values are three-point, not scalar

`content.parameter_value` stores `value_low` / `value_base` / `value_high` with a
mandatory citation and an `is_verified` flag. Two consequences:

- Curation effort (P0-5, F2) is higher than a single-figure table implies — every
  benchmark needs a defensible band, not a number.
- Unverified content cannot be published. Given the open conflicts already logged
  in the Data Sources doc (RST threshold, retención rate), **B-10's seeding step
  is gated on P0-4** more tightly than the current table shows.

## 7. Scope increase — B-9 needs coverage-tier suppression

Module 1 must *suppress* output below a coverage threshold, not merely annotate
it (risk D3). That requires `geo.data_coverage_cell` to be computed and launch
areas designated — a derived job belonging with B-4/B-5/B-6 rather than a
display concern inside B-9.

## 8. Decision that must land before B-2 ships

Multi-tenancy (`org_id`) was deliberately **not** added to the schema — a dead
column is worse than an honest gap. But it touches every table and every RLS
policy, so retrofitting after launch is expensive. If Phase 3 B2B is plausible,
the decision must be made **before B-2 migrations run**, not when B2B is
scheduled.
