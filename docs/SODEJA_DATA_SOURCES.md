# SODEJA — Data Sources & Gaps

> **✅ VERIFICATION PASS COMPLETE (2026-07-24/25).** ~24 claims re-checked against primary sources: 14 verified, 7 corrected, 5 contradicted, 6 still unverifiable. The tables below have been updated in place; corrections are marked inline. See the Verification Addendum at the end for items still open. **Six items remain genuinely unverified and are marked accordingly below — treat those as unresolved, not as confirmed by omission.**

## (a) Available now — free or near-free (verified 2026-07-24/25)

| Source | Gives | Feeds | License / limit — VERIFIED |
|---|---|---|---|
| **Microsoft GlobalML Footprints** — **now PRIMARY** | Building footprints, DR: 18 quadkey tiles (~179MB), build date **2026-02-03**, ~1% false-positive rate | M2, M3 | **CDLA-Permissive-2.0 — no share-alike** (corrected from assumed ODbL). Fresher than Google by 2.75 years. |
| Google Open Buildings V3 — demoted to cross-check/gap-fill | Per-building polygons + confidence + Plus Code; `DOM` confirmed in coverage, inference May 2023, confidence 0.65–1.0 | M2, M3 | VERIFIED: dual-licensed CC BY 4.0 **or** ODbL v1.0 (user's choice) — commercial use, storage, redistribution permitted |
| Overture Maps — Places | POIs | M1, M3, M8 | VERIFIED, mixed per source: most contributors CDLA-Permissive-2.0, Foursquare Apache 2.0, AllThePlaces CC0 — all storable/commercial. **DR coverage density itself still unmeasured — see Open Items.** |
| Overture / OSM — Buildings | Footprints | M2, M3 | VERIFIED ODbL — share-alike **does** apply to this theme specifically (per-theme licensing, not per-provider) |
| OpenStreetMap | Roads, transit, POIs | M1, M3, M8 | **CORRECTED — worse than reported.** Building coverage re-measured at **≈5.5%** (241,265 ways vs. 4,418,619 viviendas per 2022 census), not ~7%. Cannot be a base layer. |
| ONE Censo 2022 | Population 10,760,028; 4,418,619 viviendas | M1 | VERIFIED but **20.6% household omission** (worst in 20 years), skewed toward target markets (Santiago 26.1%, Santo Domingo 24.7%, La Altagracia 35.5%). Not on datos.gob.do; lives in **REDATAM (no API, manual extraction only)**; censos.gob.do currently down (HTTP 522). |
| ~~IDE-RD `RD_SECCIONES`~~ | ~~Census-section geometry~~ | M1 | 🔴 **CONTRADICTED — publishes zero layers** (WFS/WMS both return 0). **Verified substitute: OCHA COD-AB on HDX**, CC BY-IGO, ADM4/distrito-municipal only (386 features) — coarser than sección/barrio. |
| Google Places Aggregate API | Place-count queries by area/type | M1, M8 | VERIFIED exact pricing: SKU 546C-66B2-E5A6, $10/1k (to 100k/mo) tiering down to $0.75/1k (5M+), 5,000 free calls/mo, 1,200 QPM cap. **Whether counts may be persisted is still unanswered.** |
| Res. CNS-01-2025 minimum wages | Micro RD$16,993.20 / Pequeña RD$18,421.20 / Mediana RD$27,489.60 / Grande RD$29,988.00, eff. 2026-02-01 | M10 | VERIFIED exactly. **New finding: company size is a legal determination** (Ley 488-08 + MICM Res. 79-2025, dual criteria: headcount + annual gross sales), not a user input. **Restaurants use a separate wage table (CNS-04-2025, +25%), not this one.** |
| TSS ceilings (eff. 2026-02-01) | Base RD$23,223 / Riesgos RD$92,892 / SFS RD$232,230 / Pensiones RD$464,460 | M10 | VERIFIED exactly. Employee-side % verified (SFS 3.04%, AFP 2.87%). **Employer AFP % still low-confidence — do not code it** (Ley 87-01 primary text returned 403). **INFOTEP 1% of gross payroll was missing entirely — mandatory, add it.** |
| ~~ACOPROVI/ONE ICDV → RD$35,000/m²~~ | Construction cost index | M9 | 🔴 **PARTIALLY CONTRADICTED.** Index itself verified (236.17 pts, Dec 2025, +3.72% for 2025) but **ICDV publishes NO peso-per-m² figure at all** — the RD$30-45k/m² figures came from real-estate blogs, not ACOPROVI. Also: direct costs only (excludes land/design/permits/financing/profit), 4 housing typologies, DN+SD province only. **Usable as an escalation factor, not a cost basis.** |
| ONE DEE (establishments directory) | Establishments by activity, size, location | M1 | Not re-verified this pass — carried forward unchanged |

## (b) Exists but paid, gated, or legally constrained

| Source | Constraint — VERIFIED |
|---|---|
| Google Places API (standard) | VERIFIED: `place_id` confirmed exempt from caching restrictions (storable indefinitely); Google recommends refreshing IDs >12 months old (free, ID-only request — **new scheduled job needed, not currently in backlog**). Coordinates ≤30 days confirmed. |
| Google/Mapbox satellite tiles | **VERIFIED AND STRONGER THAN ASSUMED.** Google's Map Tiles API policy names, verbatim, as prohibited: "Image analysis," "Machine interpretation," "Object detection or identification," "Geodata extraction or resale," and "Offline uses ... of any of the above." **This is not a grey area — Module 2 CV is explicitly named as a prohibited use.** Mapbox terms: **not verified this pass, confidence none — do not assume it's more permissive without checking.** |
| ONE ENAE (sector economics) | Not re-verified this pass — the 16+ employee exclusion claim is carried forward unconfirmed |
| Rent listings (SuperCasas, Encuentra24, Corotos) | Not re-verified this pass — carried forward |
| Commercial mobility data (Placer.ai, Unacast) | Not re-verified this pass — carried forward |
| DGII `DGII_RNC.zip` | **CORRECTED — it IS accessible.** The earlier 403 was a User-Agent block; with a browser UA it returns 783,686 records (89.8MB). ACTIVO 49.3%, SUSPENDIDO 313,087, DADO DE BAJA 74,476. **Confirmed: no address/municipality/coordinates in 783,669 of 783,686 rows** — useful for national/sector market-sizing only, not spatial analysis without funding a geocoding effort. |

## (c) Genuinely unavailable or unreliable

| Gap | Consequence — VERIFIED |
|---|---|
| Pedestrian & vehicle traffic counts | Unchanged — still unavailable. Module 8's core pillar cannot be built as originally envisioned. |
| DR space-planning ratios (m²/seat, m²/employee, aisle widths) | Not re-verified — international heuristics used instead, must be labelled as such. |
| Commercial fit-out cost per m² by business type | **Reinforced** — ICDV cannot supply this even as a proxy (see §a). The team's own curated cost basis is now unavoidable and sits on the critical path. |
| Micro-business revenue benchmarks | Not re-verified — users supply their own, product supplies plausibility bands only. |
| Structured permit dataset (all agencies, all municipios) | **VERIFIED — gap is real.** formalizate.gob.do confirmed to cover exactly 5 things (Nombre Comercial, Registro Mercantil, RNC, TSS employer registration, Ministerio de Trabajo registration) and confirmed NOT to cover uso de suelo, municipal license, health, fire, or environmental permits. |
| Cadastral parcels | 🔴 **CONTRADICTED — worse than reported.** The portal IS programmatically reachable, but publishes **no parcel data at all**: 7 items total, 3 literally named "PRUEBA LOCALIZADOR" (test), untouched since October 2023, 0 items in the underlying ArcGIS org. This looks like an abandoned pilot, not a gated or hard-to-reach source. **No module should depend on parcel data.** |
| Utility tariffs | Still not attempted — needs a dedicated pass including generator/inverter costs common in DR. |

## Open verification items — status after 2026-07-24/25 pass

| Item | Status |
|---|---|
| Cadastral parcel availability | ✅ RESOLVED — data does not exist |
| IDE-RD GeoNode endpoints | ✅ RESOLVED — zero layers published |
| DGII RNC live schema | ✅ RESOLVED — accessible, profiled, not geocodable |
| RST threshold conflict | ✅ RESOLVED — see SODEJA_RISKS.md; both original candidates were wrong |
| Professional-services retención | ✅ RESOLVED — 15%, live since 2026-07-01 |
| e-CF / Ley 32-23 phase-in | ✅ RESOLVED — mandatory for micro/small businesses since 2026-05-15 (already binding) |
| MOPC reglamento (R-023) | ✅ RESOLVED — wrong citation confirmed; correct instrument is R-007 (Decreto 284-91), scope of application still unread |
| ONE barrio/block tables | ⚠️ PARTIAL — REDATAM has the data but no API; COD-AB substitute stops at ADM4 (distrito municipal) |
| **Places Aggregate count persistence** | 🔴 STILL OPEN — two verification attempts failed; needs a direct answer from Google or counsel |
| **Overture Places DR coverage** | 🔴 STILL OPEN — licensing is clear, but actual DR POI density has never been measured |
| TSS employer contribution percentages | 🔴 STILL OPEN — Ley 87-01 primary text returned 403 on both mirrors |
| Ley 633 primary text / actual scope of the professional reserve | 🔴 STILL OPEN — three retrieval attempts failed; needs a lawyer, not more searching |

## Verification Addendum — key findings not captured in the tables above

- **Company size (micro/pequeña/mediana/grande) is a legal determination**, not a user input: Ley 488-08 + MICM Res. 79-2025 set dual criteria (headcount **and** annual gross sales: micro ≤10 employees/≤RD$11,419,854.62; pequeña 11-50/≤RD$77,084,018.72; mediana 51-150/≤RD$288,351,329.30). SODEJA must derive the category to select the correct wage floor.
- **Restaurants/gastronomic businesses use a separate, higher minimum wage** (Res. CNS-04-2025, +25%, +12% tranche from 2026-06-01) — using the general CNS-01-2025 table for the "restaurante" business type would be wrong. Exact amounts not yet extractable (source is a scanned image, not machine-readable).
- **INFOTEP contribution (1% of gross payroll, Ley 116-80)** was missing entirely from the operating-cost model and is mandatory.
- **RST (simplified tax regime) thresholds are CPI-indexed by statute** and adjust annually by formula — they cannot be hardcoded as a literal figure in code without going stale within a year. Note also that DGII has not yet published the implementing regulation for the new thresholds, so Decreto 265-19 remains operationally in effect in the interim — the exact current threshold needs a named, dated citation before it is coded.
- **e-CF electronic invoicing is already mandatory** for micro and small businesses as of 2026-05-15 — this is a live obligation for SODEJA's target users today, not a future one, and Module 11/12 content should reflect that.
- A new corporate criminal liability regime (data-protection related offenses under a new Penal Code) is reported to take effect around August 2026 — see SODEJA_RISKS.md L5 for full detail and confidence caveats; the underlying text was reported as still in flux as of a Senate amendment on 2026-07-23, so treat specifics as provisional pending direct legal review.

**Full multi-agent verification trace (per-claim source URLs, confidence levels, and reasoning) is preserved in the planning session record; ask the assistant to retrieve specific citations on request rather than duplicating the entire trace here.**
