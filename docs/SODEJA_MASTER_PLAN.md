# SODEJA — Master Plan

Status: **Approved by product owner 2026-07-24. Verification pass completed 2026-07-25** — see [SODEJA_DATA_SOURCES.md](./SODEJA_DATA_SOURCES.md) and [SODEJA_RISKS.md](./SODEJA_RISKS.md) for full findings. Several corrections below resulted from that pass; a handful of items remain open and require a business decision, paid service, or legal engagement (flagged inline, and tracked for the product owner separately).

Sodeja is a web + Android application for geographic business evaluation, commercial-space analysis, capacity estimation, financial projection, regulations and business-plan generation in the Dominican Republic (DR).

## 0. Executive Summary — Five Decisions That Matter

1. **Do not build a computer-vision model for Module 2.** Google Open Buildings V3 reportedly covers the DR under a commercially-usable license (CC BY 4.0 / ODbL) — building detection becomes a database query, not an ML project. *(License/coverage claim pending verification.)*
2. **Foot-traffic data does not appear to exist for the DR at any workable price**, and the obvious source (Google Popular Times) has no public API and would require scraping. Module 8 ships with a transparently labelled proxy index, or not at all — a permanent constraint, not a temporary gap.
3. **Module 11 (tax) must be reframed from advisor to information directory.** DR law reportedly reserves accounting consultancy to licensed CPAs (Ley 633), and the underlying tax law changed recently (Ley 30-26, cited 2026-06-18). *(Pending legal verification.)*
4. **Curated DR data is the critical path, not the software.** Nearly every benchmark number (fit-out cost, capacity ratios, revenue benchmarks) needs hand-curation and ongoing maintenance — this must be budgeted as a recurring role, not a one-time load.
5. **Ship narrow:** 2 metro areas (Distrito Nacional + Santo Domingo province, and Santiago), 4-6 business types, ranges never point estimates.

## 1. Module Analysis

| # | Module | MVP Verdict | Note |
|---|---|---|---|
| 1 | Geographic Market Study | MVP (narrowed, verified riskier) | ONE census (verified, but 20.6% household omission, worst in 20 years, skewed toward Santiago/Santo Domingo) + geometry via OCHA COD-AB (IDE-RD `RD_SECCIONES` was found to publish zero layers — substitute is coarser, distrito-municipal level, not sección/barrio) + POI competition counts. Demand output must ship as a wide band with an explicit data-quality disclosure, not a point estimate. |
| 2 | Intelligent Commercial-Space Detection | MVP as footprint retrieval; real CV deferred | **Footprint source flipped to Microsoft GlobalML as primary** (verified: CDLA-Permissive license — no share-alike — and 2.75 years fresher than Google Open Buildings, which becomes cross-check/gap-fill). Google's Maps Tiles ToS was verified to explicitly name "object detection," "image analysis" and "machine interpretation" as prohibited uses — Module 2 CV deferral is now a documented policy constraint, not an inference. |
| 3 | Direct Map Selection | MVP — highest confidence | UI over the Module 2 data layer; needs a manual polygon-draw fallback — more important than originally scoped, since OSM building coverage was re-measured at ≈5.5% (not ~7%). |
| 4 | Preliminary Space Layout | MVP (reduced) | Parametric ratio templates + user-entered dimensions; ratios are international, not DR-specific — must be labelled. |
| 5 | Business Simulator | MVP — ready | Type selector driving parameter sets; constrained to 4-6 business types at launch. |
| 6 | Commercial Capacity Estimator | MVP (reduced) | Deterministic math is trivial; ratios lack DR ground-truth — ranges only, editable. |
| 7 | Financial Projection | MVP (reduced) | Engine is straightforward; revenue side lacks DR benchmarks — assumption-driven, editable defaults, ranges. |
| 8 | Location Evaluator | Phase 2 | Traffic pillar cannot be built (see §0.2); ships with a labelled proxy index plus a data-confidence score. |
| 9 | Fit-Out Cost Estimator | MVP (reduced, cost basis confirmed unavailable) | Verification found ACOPROVI/ONE ICDV publishes **no peso-per-m² figure at all** (the RD$30-45k/m² figures were misattributed from real-estate blogs) and even the index itself covers only direct housing-construction costs in DN+Santo Domingo province. Usable only as an inflation/escalation factor. The team's own curated cost dataset is now unavoidable and sits on the critical path. |
| 10 | Operating Cost Estimator | MVP — strongest module | Payroll/TSS legs verified exactly, but two additions are required: **INFOTEP (1% of gross payroll) was missing entirely**, and **"restaurante" needs its own wage table** (Res. CNS-04-2025, +25% over the general minimum, not yet machine-readable — sourced from a scanned document). Company size (which selects the wage floor) is a legal determination from dual criteria (headcount + gross sales, Ley 488-08/MICM Res. 79-2025), not a user input. |
| 11 | Tax & Accounting Assistant | Phase 2 (scope simplified — good news) | Reframed as information directory (see §0.3) — and the Ley 633 "regulated practice" justification for that framing did not hold up on verification (only narrow acts like audits/signing statements are reserved); the framing survives on liability grounds instead (a wrong tax figure directly costs users money). Separately, RST caps were found to be far higher than assumed, meaning most of SODEJA's target users fall under the simpler simplified regime — scope RST-first, ordinary regime as the edge case. e-CF electronic invoicing is confirmed **already mandatory** for micro/small businesses since 2026-05-15. |
| 12 | Regulation Verifier | MVP (narrow) | Non-exhaustive checklist, 2 municipalities + national permits; no "compliant" affordance. **Citation corrected: use MOPC R-007 (Decreto 284-91), not R-023 (which is school-specific)** — R-007's exact scope of application still needs to be read before asserting compliance claims. formalizate.gob.do confirmed to cover only business-formation steps, not use-of-land/health/fire/environmental permits — the gap this module addresses is real. |
| 13 | Business Plan Generator | Split | Phase 1: labelled "Resumen de Análisis" summary tier. Phase 2: full bank-facing "Plan de Negocio", gated on validation against real DR businesses. |

## 2. Realistic MVP Definition

**One complete, sellable vertical slice: an "Estudio de Ubicación Comercial."**

> User opens a map of Santo Domingo or Santiago → taps a building → sees its approximate area, address, and nearby businesses → picks a business type → gets a capacity estimate, a fit-out cost range, an operating cost breakdown, and a financial projection with break-even as a range → gets a permits checklist → exports a summary document.

**In scope:** Modules 3, 2 (footprint retrieval only), 1 (narrow), 5, 4 (ratio-based), 6, 9, 10, 7, 12 (narrow), 13 (summary tier only).
**Out of MVP:** Modules 8 and 11.

**Constraints that define "MVP" as much as the module list:**
- **Geography:** Distrito Nacional + Santo Domingo province + Santiago only. Everywhere else is explicitly "not covered."
- **Sectors:** 4-6 business types (restaurante, colmado/convenience, ferretería, salón, minimarket).
- **Numeric posture:** ranges (pessimistic/base/optimistic), never point estimates. Every assumption visible, editable, and provenance-tagged (`usuario` / `referencia sectorial` / `estimado`).

## 3. Development Phases

- **Phase 0 — Foundation & validation:** data-source coverage spikes, unit-economics model, pricing validation with ~15 prospective users, engage a DR accountant + lawyer, legal reads on data licenses, stand up the data-curation workstream, ONAPI trademark search.
- **Phase 1 — MVP:** the vertical slice in §2. Web-first; Android as a thin online-capable companion.
- **Phase 2 — Depth and field use:** Module 8 (with proxy index), Module 11 (tax directory), full Module 13 business plan, content admin CMS, more municipalities/sectors, full Android offline support.
- **Phase 3 — Differentiation:** genuine computer vision, usage-derived benchmark datasets (the data moat), analytics, possible B2B multi-tenant.

See [SODEJA_MVP_BACKLOG.md](./SODEJA_MVP_BACKLOG.md) for the dependency-ordered backlog.

## 4. Open Decisions (from the planning team, awaiting product-owner input)

1. Is "AI detection" (Module 2) a marketing claim or a real capability commitment? (~10x budget difference either way.)
2. Who is the buyer — self-serve SMB, or B2B2C via banks/microfinance/franchisors/brokers? Changes Phase 1 requirements.
3. Team language skills (TypeScript vs. Dart) — determines the Android stack recommendation (React Native vs. Flutter).
4. Confirm budget/timeline for Phase 0 human tasks (accountant, lawyer, data curation owner) — these are not agent-executable and gate everything downstream.

## 5. Caveats

The legal observations in this plan are risk-planning, not a legal opinion — items flagged in [SODEJA_RISKS.md](./SODEJA_RISKS.md) as Legal warrant review by Dominican counsel before launch. Tax and geospatial figures cited across these documents carry known unresolved conflicts (see [SODEJA_DATA_SOURCES.md](./SODEJA_DATA_SOURCES.md) §Open Verification Items) and must not be relied upon or coded against until verified against primary sources.
