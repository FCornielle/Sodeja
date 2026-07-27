# SODEJA — Risk Register

> **✅ VERIFICATION PASS COMPLETE (2026-07-24/25).** Legal items below are risk-planning, not a legal opinion — DR counsel review is still required before launch, and is now urgent (see L5 and D-2 in the addendum). Severities and citations below have been corrected against primary sources where verification was attempted; items not re-checked are marked "not re-verified."

24 risks identified across four categories; severities updated below — **8 now rated High** (L5 was raised from Med-High).

## The structural risk (stated first)

The chain **Module 2 (area) → Module 6 (capacity) → Module 7 (projection) → Module 13 (business plan)** is the single largest risk concentration in the product. An unvalidated area estimate can propagate silently into a break-even number a user might borrow against. Most High-severity mitigations below converge on the same answer: decouple that chain, and never let an estimate enter it without user confirmation and a visible uncertainty band.

## Legal

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| L1 | Financial projections (M7, M13) treated as authoritative; user loses capital | High | Non-dismissible disclaimer on every export; ranges only; versioned ToS acceptance logged; DR counsel to review limitation-of-liability language |
| L2 | Module 11 may cause direct user harm if wrong (DGII surcharges/penalties) | High | **CORRECTED 2026-07-25:** the Ley 633 "regulated practice" justification does NOT hold as originally stated — verification found only narrow reserved acts (audits, signing financial statements with fe pública, expert witness), not tax advice/return prep/bookkeeping. The mitigation is unchanged (information directory only, no computed liabilities, "consulte a un CPA autorizado") but the reasoning is now liability-based, not licensing-based: a wrong tax figure directly costs the user money with SODEJA as proximate cause. **Low-to-medium confidence negative finding — still needs a lawyer to close (see addendum D-2), do not treat "no prohibition found" as "confirmed no prohibition."** |
| L3 | Module 12 false negative → user opens a business, then is shut down after fit-out capital is spent | High | Non-exhaustive checklist framing; no "compliant" affordance; per-item source + last-updated date. **Correct citation is MOPC R-007 (Decreto 284-91), not R-023 — see addendum.** |
| L4 | ToS violation via ML/derived content on commercial map imagery → API key termination | High | **VERIFIED AND STRENGTHENED:** Google's Map Tiles API policy names "object detection or identification," "image analysis," and "machine interpretation" as prohibited uses verbatim. This is a documented prohibition, not an inference — treat as non-negotiable, including for prototypes. Never run detection or persist derived content against commercial-tile imagery. Mapbox terms not verified — do not assume more permissive without checking. |
| L5 | Ley 172-13 (DR data protection) — consent and cross-border transfer requirements | **High (raised from Med-High)** | **CORRECTED:** consent must be "libre, expreso y consciente" with a durable written/equivalent record (Art. 5(4)) — stricter than the "prior/unambiguous" framing originally used; a silent opt-in does not satisfy it. Cross-border transfer (Art. 80) is workable with express consent + hosting-jurisdiction disclosure. **Good news: no DPA registration/filing requirement exists.** **Reason for the raise: Ley 74-25 (new Penal Code) introduces corporate criminal liability for the first time in DR law — including entity dissolution as a possible sanction — reportedly covering offenses on personal data in automated systems, entering into force ~August 2026 (~1 month out), with the text reportedly amended by the Senate on 2026-07-23. This needs direct legal review as a matter of urgency (see addendum D-2) — confidence on the exact offense scope is low, treat as provisional.** |
| L6 | ODbL share-alike may attach to a derived building database | **Low-Medium (downgraded from Med)** | **CORRECTED:** ODbL's "Produced Work" exception (§4.3, via query) and internal-use exception (§4.5(c)) mean query-time use and even an internally-held derivative database do NOT trigger share-alike. **Condition: never ship a bulk data export or database API of OSM-derived data as a product feature** — per-location analyses and PDF reports are fine. Attribution still required. Independently reinforced by the Microsoft footprint switch (CDLA-Permissive, sidesteps ODbL entirely — see SODEJA_DATA_SOURCES.md). |
| L7 | Generated business plan used to obtain financing; disputes reach SODEJA | Med | Watermark, assumptions appendix, generation date, explicit "user-supplied and model-generated, unaudited" statement |
| L8 | Trademark conflict on "SODEJA" | Low | ONAPI search + registration before launch spend |

## Technical

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| T1 | Area estimation error (reported ±20-40%) multiplied through capacity and revenue | High | User-entered/drawn area is authoritative in MVP; detection is a suggestion requiring confirmation, never a silent input |
| T2 | Map/imagery provider dependency — pricing or quota changes | High | Provider abstraction layer from day one; at least one validated fallback; server-side proxy; hard caps + billing alerts |
| T3 | Regulation/tax content staleness (the mechanism by which L2/L3 actually cause harm) | High | **REINFORCED — demonstrated, not theoretical:** RST thresholds are CPI-indexed by statute (adjust annually by formula, not a fixed number); DGII has not yet published the implementing regulation for recent changes, so the old and new rules are currently both partially in effect; the verifying analyst's own report from the same day already contained two figures that had gone stale within weeks. Everything must be versioned with effective dates + source URL, admin-editable, never hardcoded constants; named owner, recurring review cadence — this is not optional overhead. |
| T4 | Geospatial query scaling | Med | PostGIS indexing, pre-aggregated population grid, caching |
| T5 | Android performance on low/mid-end devices over intermittent connectivity | Med | Online-required for maps in MVP, offline-readable saved analyses; test on real throttled devices |
| T6 | Cross-module numerical drift (e.g. Module 8 contradicting Module 7 for the same site) | Med | One canonical assumption set per project, one engine, golden-file regression tests |
| T7 | Breach of stored business plans (sensitive + a data-protection event) | Med | RLS as the enforcement layer; TLS + encryption at rest; no PII in logs; no API keys shipped in the APK |

## Financial (to the SODEJA business)

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| F1 | Variable per-call API cost against a price-sensitive market; margin can invert unnoticed | High | Model cost-per-analysis before building; quota-based pricing; aggressive caching; hard caps + alerts |
| F2 | Curated DR content is the differentiator and a permanent recurring cost | High | **REINFORCED:** every "we'll source this" assumption that was checked came back requiring manual curation — fit-out costs (ICDV can't price them), rent (no index), permits (no dataset), census (no API, manual REDATAM extraction), gastronomic wages (scanned PDF, not machine-readable). The curation workstream is larger than originally scoped. Explicit budget line; narrow scope (2 metros, 4-6 sectors); crowd-sourced inputs; consider data partnerships |
| F4 | 13 modules is a long runway to first revenue/validation | Med-High | Ship the thin MVP vertical slice; defer the highest legal-load modules (11, 12 full scope) |
| F3 | Willingness-to-pay may be lowest where the product is most useful | Med | Validate pricing with ~15 prospects pre-build; resolve the B2B2C-vs-self-serve question in Phase 0 |
| F5 | Single-provider commercial concentration | Low-Med | Covered structurally by T2's provider abstraction |

## Data quality

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| D1 | Garbage-in-garbage-out: confident-looking output from unreliable user inputs | High | Pre-fill with sector benchmarks; flag implausible deviations; mandatory sensitivity display; never show more precision than the input supports |
| D2 | Stale/incomplete census; informal competition invisible to any dataset | **High (materially worse than originally assessed)** | **CORRECTED:** actual household omission is 20.6% (worst in 20 years vs. ~8-10% in prior censuses), and it's geographically skewed toward SODEJA's exact target markets (La Altagracia 35.5%, Santiago 26.1%, Santo Domingo 24.7%). ONE itself attributes part of this to cartography imprecision, which also undermines confidence in census geometry. This is a product-credibility risk, not a minor caveat — Module 1 demand output must ship as a wide band with an explicit undercount disclosure (dataset-vintage display alone is insufficient); explicitly prompt users to add observed competitors manually |
| D3 | Uneven data coverage silently reads as "low competition" instead of "low data" | High | **Reinforced: OSM building coverage re-measured at ≈5.5% (not ~7% as originally reported), reinforcing that OSM cannot be a base layer.** Per-area data-coverage score; suppress/caveat analysis below a coverage threshold; launch only where the threshold is met |
| D4 | No ground truth for area/capacity estimates | High | Build a 30-50 space ground-truth set; instrument user overrides as a continuous accuracy signal; publish no accuracy claim until measured |
| D5 | Capacity ratios reflect non-DR (US/EU) practice | Med | Sector-specific, sourced, user-adjustable, ratio visible |
| D6 | Location comparison (Module 8) silently rewards data density | Med | Surface the D3 confidence score per compared location |
| D7 | Fit-out/rent benchmarks drift with inflation and FX | Med | **Correction: ICDV is confirmed usable only as an escalation/inflation factor — it has no RD$/m² basis from any verified source.** Date-stamp figures; apply inflation adjustment with visible base date |

---

## Verification Addendum (2026-07-24/25)

**MOPC citation corrected:** R-023 is confirmed to be "Reglamento para el Diseño de Plantas Físicas Escolares" (school buildings, Decreto 305-06) and must not be cited for commercial accessibility. The correct instrument is **MOPC R-007, "Reglamento para Proyectar sin Barreras Arquitectónicas" (Decreto 284-91)** — identity and decree number confirmed, but its scope of application (which building types/occupancy thresholds it binds) could not be read this pass and remains unverified. Do not assert in-product that a commercial space "must comply with R-007" until that scope is confirmed. MOPC maintains 30+ reglamentos; Module 12's construction-side coverage should be scoped from the official index, not assembled ad hoc.

**Confidence discipline:** three findings above are negative findings at low-to-medium confidence — the Ley 633 reserve scope (L2), the Ley 74-25 data-offense provisions (L5), and Mapbox's derived-works terms (L4). "Could not verify a restriction" is not the same as "verified as unrestricted" — none of these should be treated as closed.

**Items requiring a business decision, paid service, credentials, or legal engagement before they can be closed** (not actioned by the planning team — surfaced to the product owner separately): engaging DR counsel on Ley 74-25 and Ley 633 (urgent — Ley 74-25 is reported to enter into force ~August 2026), obtaining a direct answer from Google on Places Aggregate count persistence, selecting and reviewing a map/imagery provider's derived-works terms, and funding retrieval of primary legal texts that returned access errors (Ley 87-01, MICM Res. 79-2025).
