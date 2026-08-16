# `apps/api` — SODEJA API (Modular Monolith)

**Status: `providers` (B-3), `catalog` (B-11), `projects` (B-11a + B-7a's
area-confirmation slice), `capacity` (B-12), `costs` (B-14 fit-out +
B-15 opex), `finance` (B-17), `geo` (B-7's read-only slice),
`market-study` (B-9), `layout` (B-13's read-only parameter slice), `permits`
(B-18) and `legal` (B-20's minimal slice) are implemented. Every other
module below is still a placeholder.**

One deployable containing every product module except the three day-one
carve-outs (`services/pdf-worker`, `services/ingestion`, `services/geo-ml`).

## Intended stack

NestJS + TypeScript. Chosen for its module system, which maps 1:1 onto the
product modules and gives real boundaries at no runtime cost. Validation via
`@sodeja/schemas`; calculations via `@sodeja/calc`; rule evaluation via
`@sodeja/rules`.

## Module layout (Phase 1)

| NestJS module | Product module | Notes |
|---|---|---|
| `auth` | — | Not built. Supabase JWT verification; RLS is the real enforcement layer. Until it lands, every route below reads `userId` from an `x-user-id` header (`src/common/current-user-id.decorator.ts`) — an explicit placeholder, not an auth boundary |
| `projects` | — | **Implemented (B-11a + B-7a + B-8's POI use-label), minimal.** `POST /projects` (create only — no update/delete/list) + the assumptions sub-resource + `PUT /projects/:id/location` (the area-confirmation gate) + `GET /projects/:id/poi-label`. See "B-11a contract", "B-7a contract" and "B-8 contract" below |
| `geo` | 2, 3 | **Implemented (B-7's slice), minimal.** Read-only footprint lookup + launch-area coverage — just enough to unblock the map UI's Step 1. Full footprint-confirm/polygon-validation is B-8, not built here. See "B-7 contract" below |
| `market-study` | 1 | **Implemented (B-9).** `POST /projects/:id/market-study`, `PATCH /projects/:id/market-study/manual-competitors` — see "B-9 contract" below |
| `catalog` | 5 | **Implemented (B-11).** `GET /business-types` — see "B-11 contract" below |
| `layout` | 4 | **Implemented (B-13), read-only.** `GET /projects/:id/layout-parameters` — see "B-13 contract" below. No typology ratio templates exist: none are citable |
| `capacity` | 6 | **Implemented (B-12).** `POST /projects/:id/capacity-estimate` — see "B-12 contract" below |
| `costs` | 9, 10 | **Implemented (B-14 + B-15).** `POST /projects/:id/fitout-estimate`, `POST /projects/:id/opex-estimate` — see "B-14/B-15 contract" below |
| `finance` | 7 | **Implemented (B-17).** `POST /projects/:id/financial-projection` — the integration point. See "B-17 contract" below |
| `permits` | 12 | **Implemented (B-18), read-only.** `GET /projects/:id/permits-checklist` — see "B-18 contract" below. Named `rules` in earlier drafts of this table; the NestJS module is `permits`, since `@sodeja/rules` is the package it calls into |
| `reports` | 13 | Not built. Enqueues work; does not render |
| `legal` | — | **Implemented (B-20's minimal slice), read-only.** `GET /legal/documents/:kind/current` — see "B-20 contract" below. ToS acceptance tracking, Ley 172-13 consent, and export/delete are deliberately NOT built (need the login flow, UX spec Step 0, which does not exist yet) |
| `providers` | — | **Implemented (B-3).** Server-side proxy for all external map/POI providers |

## B-11 contract — `catalog` (`src/catalog/`)

`GET /business-types` — no auth required (reference content, RLS disabled on
`content.*`). Returns `BusinessTypeCatalogEntry[]` (`@sodeja/schemas`
`project.ts`):

```ts
{
  slug: string;            // e.g. "restaurante"
  nameEs: string;
  descriptionEs: string | null;
  parameters: ResolvedParameter[]; // every domain='capacity' parameter_table
                                    // that resolved for this business type,
                                    // as of today, with NO jurisdiction
                                    // override (national/generic ratios)
}[]
```

`parameters` may be `[]` for a business type with no covered ratio — currently
`salon` (see the B-11 migration,
`packages/db/migrations/1785520000000_seed-capacity-parameters.sql`, for
why). `ResolvedParameter` (`@sodeja/schemas` `primitives.ts`) always carries a
`citation` and `provenance`; nothing in this response is ever a fabricated or
unverified figure — `@sodeja/rules`' `toCitation()` throws before that could
happen.

## B-11a contract — `projects` (`src/projects/`)

**`POST /projects`** — body `{ name, businessTypeId, jurisdictionId }`
(`CreateProjectRequestSchema`). Returns `201` with a `Project`
(`id, name, businessTypeId, jurisdictionId, status, createdAt`). `400` on a
missing/invalid `x-user-id` or a body that fails Zod validation; `409` if
`businessTypeId`/`jurisdictionId` do not reference an existing row.

**`GET /projects/:id/assumptions`** — returns `ProjectAssumption[]`, **a bare
array, no envelope**. One row per `app.project_assumption`. On first call
(zero existing rows) it **materializes and persists** one row per
`content.parameter_table` that resolves (via `@sodeja/rules`) for the
project's `business_type_id` + `jurisdiction_id` + today's date — across
**every domain currently seeded** (tax/labor/construction/capacity/layout/
rent/utilities), not only `capacity`. Concretely, today that means every
project also gets B-10's national labor rows (TSS ceilings, INFOTEP, and
*all four* company-size minimum-wage tiers) alongside B-11's capacity ratios.
**Which wage tier actually applies is a legal determination (Ley 488-08 dual
criteria) that this endpoint does NOT make** — B-15 must select/filter, this
endpoint only materializes what resolves. `404` if the project does not
exist or is not owned by the caller (RLS makes these indistinguishable by
design). `409` if the project has no `business_type_id` set.

```ts
// ProjectAssumption (@sodeja/schemas project.ts)
{
  id: number;
  projectId: string;               // uuid
  key: string;                     // = content.parameter_table.slug
  labelEs: string;
  unit: string;
  valueLow: number; valueBase: number; valueHigh: number; // CURRENT effective value
  currency: "DOP" | "USD" | null;
  provenance: "usuario" | "referencia_sectorial" | "estimado";
  defaultParameterValueId: number | null; // provenance metadata only
  isOverridden: boolean;
  implausibleFlag: boolean;
  updatedAt: string; // ISO datetime
}
```

**How a consumer (B-12/B-14/B-15) reads "the current value of assumption X
for project Y"**: `GET /projects/:id/assumptions`, find the row with
`key === X`, read `valueLow`/`valueBase`/`valueHigh`. Those three fields are
**always** the current, effective value — whether or not `isOverridden` is
true. Never re-resolve `defaultParameterValueId`; it only records where the
original pre-fill came from.

**`PATCH /projects/:id/assumptions/:key`** — body
`{ valueLow, valueBase, valueHigh }` (`AssumptionOverrideRequestSchema`,
`400` if `valueLow > valueBase` or `valueBase > valueHigh`). Sets
`is_overridden = true`. Sets `implausible_flag = true` when the new
`valueBase` falls outside the assumption's **original default's**
`[value_low, value_high]` band (never the row's own current band, which may
already reflect a prior override) — a warning, **never** a rejection.
`404` if `key` was never materialized for this project (call `GET
.../assumptions` first). Returns:

```ts
// AssumptionOverrideResponse (@sodeja/schemas project.ts)
{
  assumption: ProjectAssumption; // the updated row, same shape as above
  invalidated: EstimateType[];   // subset of ["capacity_estimate",
                                  // "fitout_estimate", "opex_estimate",
                                  // "financial_projection"]
}
```

`invalidated` comes from a static `domain -> estimate type[]` map
(`src/projects/assumption-invalidation.ts`) keyed off the overridden
assumption's `content.parameter_table.domain` — e.g. a `domain='capacity'`
change never claims to invalidate `fitout_estimate`. It is a hint for the
client to prompt a recompute, **not** an audit log and **not** a claim that
those estimates were actually recomputed — B-12/B-14/B-15/B-17 own
recomputation itself.

## B-7a contract — area confirmation gate (`src/projects/`, `src/common/area-gate.ts`)

**`PUT /projects/:id/location`** — body
`{ areaSqm, centroidLon, centroidLat, areaSource? }`
(`ConfirmProjectLocationRequestSchema`). Idempotent upsert into
`app.project_location`; writes `area_confirmed_at = now()` and the caller's
`areaSource`, **defaulting to `'user_entered'` when absent** (B-8 added the
field; pre-B-8 callers had no map UI, so a typed number is genuinely what
they sent). The API never *infers* the provenance — whether a confirmed area
is still the footprint dataset's own figure or something the user changed is
only knowable by the client that showed them the footprint. `404` if the
project does not exist or is not owned by the caller; `400` on an
out-of-range lon/lat or an `areaSource` outside the enum. Returns:

```ts
// ProjectLocation (@sodeja/schemas project.ts)
{
  projectId: string;       // uuid
  areaSqm: number;
  areaSource: "footprint_dataset" | "user_drawn" | "user_entered";
  areaConfirmedAt: string; // ISO datetime
  centroidLon: number; centroidLat: number;
  updatedAt: string;
}
```

## B-8 contract — POI use-label (`src/projects/`)

**`GET /projects/:id/poi-label`** — what `geo.poi_place` records as being at
the project's confirmed site, so the UI can show "there is currently a
[category] here" and let the user confirm or correct it. Behind the same
B-7a area gate (`409` if the area is not confirmed); `404` if the project
does not exist or is not owned by the caller.

```ts
// ProjectPoiLabel (@sodeja/schemas project.ts)
{
  category: string | null;      // = content.business_type.slug, normalized at ingest (B-5)
  name: string | null;
  distanceM: number | null;
  sourceVintage: string | null; // ISO date
}
```

Returns the **single nearest** `geo.poi_place` within **40m** of the
confirmed centroid. Finding nothing returns all-`null` with a `200` — never
a `404`. That is a real, common answer, and a client must render it as "no
record", never as an empty category label: informal DR businesses are
invisible to every dataset (risk D2), so absence of a record is not absence
of a business.

The 40m radius absorbs the offset between a footprint centroid and an
address/entrance-geocoded Overture place without reaching across a DR urban
block (~80–100m in the launch areas) and mislabelling the business opposite.
It errs small on purpose — a missed label costs one typed answer, a wrong
label is a confident claim about the user's site they may not think to
correct (`POI_LABEL_RADIUS_M`, `src/projects/projects.service.ts`).

`category` is returned exactly as stored — already mapped to a
`content.business_type.slug` at ingest time by
`services/ingestion/src/transform/poiPlaceRow.ts`'s `mapOvertureCategory`,
never re-mapped here. It is nullable **independently of `name`**: rows whose
raw Overture category maps to no business type this product models are kept
at ingest, so "a named place is here but we can't classify it" is a real
state. **No override is persisted** — this endpoint is read-only; a user
correcting the label is informational to the UI only (see "Related backlog
items" for what a persisted override would need).

**The gate itself** (`src/common/area-gate.ts`'s `requireConfirmedArea`) is
called by `capacity`, `fitout`, and `opex` before any computation: `409` if
`app.project_location` has no row for the project or `area_confirmed_at IS
NULL`. This is risk T1's mitigation enforced in code, not merely documented.

## B-12 contract — `capacity` (`src/capacity/`)

**`POST /projects/:id/capacity-estimate`** — body `{ staffCount? }`
(`CapacityEstimateRequestSchema`). Computes AND persists a new
`app.capacity_estimate` row (no separate `GET`; call again to recompute).
`404` if the project does not exist/is not owned by the caller; `409` if the
area is not confirmed (B-7a) or the project has no business type.

Resolves the project's business type's `domain='capacity'` ratio (via
`@sodeja/rules`) and divides the confirmed area by it using `@sodeja/calc`'s
`Range` primitives — `seats_low/base/high` are `null`, with a reason string
in `resultsJson.seatsReason`, for a business type with no seeded ratio
(currently `salon`; this is a legitimate absence per the B-11 migration, not
an error). `staff_low/base/high` are populated **only** from the request's
`staffCount` — no staffing-density ratio exists to derive one from (see the
B-11 migration's comments); omitted, `staff_*` is `null` with a reason.
`daily_customers_*` is always `null` — no `rotación`/turnover input exists
yet to derive it from a real basis.

## B-13 contract — `layout` (`src/layout/`)

**`GET /projects/:id/layout-parameters`** — the only `layout` route, and a
pure read. There is no `POST`, no `app.layout_zone` row, and no
server-computed zone split: **B-13's zone shares are user-entered**, because
no standards body publishes zone-to-zone *area proportions* for these
business types (`packages/db/migrations/1785550000000_seed-layout-parameters.sql`
seeds zero `content.layout_template` rows and explains why at length). The
allocation itself is `@sodeja/calc`'s `allocateLayoutZones` /
`checkLayoutZonePlausibility`, which the client runs — the same TypeScript
artifact on web and on device (`apps/mobile/README.md`). This endpoint
supplies only the three things a client cannot derive for itself.

`404` if the project does not exist/is not owned by the caller; `409` if the
area is not confirmed (B-7a) or the project has no business type.

```ts
// LayoutParameters (@sodeja/schemas project.ts)
{
  areaSqm: number;                        // the CONFIRMED area → allocateLayoutZones' totalAreaSqm
  businessTypeSlug: string;
  densityParameters: ResolvedParameter[]; // every domain='layout' parameter_table
                                          // resolved for this business type, as of
                                          // today, no jurisdiction override
  expectedOccupants: number | null;       // latest capacity_estimate.staff_base
  expectedOccupantsReason: string | null; // why it is null
}
```

`densityParameters` is `[]` for a business type with **no cited zone** —
`salon` has none at all, and the customer-facing zones of every type have
none either (IBC Table 1004.5 covers storage and commercial kitchens here;
that is the whole coverage). Empty means "no citation covers any zone of this
business type", so the client runs the allocation with no plausibility
comparison. It never means an error, and a client must **never** substitute
another business type's density for a missing one.

Mapping a `parameterTableSlug` onto a zone slug is the **client's** call, the
same way `LayoutZoneDensityCheck.zoneSlug` is: the client owns the zone
vocabulary the user typed shares against, and this endpoint does not invent
zone names the user never saw.

`expectedOccupants` is the latest `app.capacity_estimate`'s **`staff_base`**
— not `seats_base`, not `dailyCustomers_base`. An IBC stockroom or
commercial-kitchen occupant load counts the people *working in that zone*,
which is not the population the sales floor is sized for
(`packages/calc/src/layout.ts`, `LayoutZoneDensityCheck`). It is `null` when
no capacity estimate exists yet, or when the latest one carries no staff
figure (no staffing-density ratio is seeded — B-12 populates `staff_*` only
from an explicit `staffCount`, and a stored `0` is reported as absent because
the engine will not divide against it). `null` is a normal state, not an
error: the client then runs `allocateLayoutZones` alone. It must never pass
`0` or a guessed figure in its place.

## B-14/B-15 contract — `costs` (`src/costs/`)

**`POST /projects/:id/fitout-estimate`** — body
`{ baseCostPerSqmLow, baseCostPerSqmBase, baseCostPerSqmHigh, currency? }`
(`FitoutEstimateRequestSchema`, `currency` defaults `"DOP"`). The base
construction cost per m² is **always** the caller's own input — no DR
commercial fit-out cost basis exists at any confidence level
(`docs/SODEJA_DATA_SOURCES.md`), so nothing is seeded as a default. `409` if
the area is not confirmed. Computes `total = baseCostPerSqm × area ×
(1 + ICDV escalation rate)` via `@sodeja/calc`, where the ICDV rate is the
one real, cited DR construction figure
(`packages/db/migrations/1785540000000_seed-construction-icdv.sql`, +3.72%,
Dec 2025). `indexBaseDate` is always `"2025-12-01"` (the index's real date,
never the compute date). `resultsJson.disclaimer` always carries the
"indicative, not authoritative" caveat the schema comment requires.

**`POST /projects/:id/opex-estimate`** — body
`{ companySize, staffCount?, monthlyRentDop?, monthlyUtilitiesDop? }`
(`OpexEstimateRequestSchema`). `409` if the area is not confirmed, or if
neither a usable staff count nor rent/utilities are available at all (never
persists an all-`null` row — `app.opex_estimate`'s amount columns are `NOT
NULL`). `companySize` is **required and explicit** — the real dual-criteria
legal determination (Ley 488-08: headcount AND annual gross sales) cannot be
evaluated without a financial projection (B-17, not built), so this
endpoint never guesses a tier.

Staff count comes from the project's latest `app.capacity_estimate.staff_*`
by default; `staffCount` on the request overrides that when the capacity
estimate has none. Payroll = staff count × the minimum-wage tier for
`companySize`, plus TSS employee-side SFS (3.04%) + AFP (2.87%) + INFOTEP
(1%), all resolved via `@sodeja/rules` from `1785510924741_seed-rules-content.sql`
— never a hardcoded literal. **TSS employer-side AFP % is never computed**
(`resultsJson.employerAfpNote` documents why: Ley 87-01's primary text
returned 403 on both verification attempts). For `restaurante` specifically,
`resultsJson.restaurantWageCaveat` flags that the general wage table
understates the real (separate, higher) gastronomic minimum wage, which was
not seedable (scanned, non-machine-readable source). Rent/utilities are
optional, uncurated line items — supplied directly or absent; `resultsJson.partial`
is `true` whenever either is missing, so the total is legible as incomplete
rather than presented as a full opex picture.

## B-17 contract — `finance` (`src/finance/`)

**`POST /projects/:id/financial-projection`** — body
`{ monthlyRevenueLow, monthlyRevenueBase, monthlyRevenueHigh, horizonMonths? }`
(`FinancialProjectionRequestSchema`, `horizonMonths` defaults `36`, capped at
`60`). Monthly revenue is the **one genuinely new input** this endpoint
introduces, and it is **required and explicit** — no DR micro-business
revenue benchmark exists at any confidence level
(`docs/SODEJA_DATA_SOURCES.md`), so it is never derived from
`capacity_estimate`'s seat/customer counts via an invented ticket-price x
turnover formula (B-12 left `dailyCustomers` null for the same reason).
Amounts are in the project's `reporting_currency`; no separate currency
field exists on the request.

**Prerequisites gate (the most important behavior of this endpoint):**
fetches the project's confirmed area (`requireConfirmedArea`, B-7a) plus the
latest `capacity_estimate`, `fitout_estimate`, and `opex_estimate`. Every
missing prerequisite is collected — not just the first one found — into a
single `409`:

```json
{
  "message": "financial projection is blocked: 2 prerequisite(s) missing",
  "missing": [
    "missing: fitout_estimate — POST /projects/:id/fitout-estimate first",
    "missing: opex_estimate — POST /projects/:id/opex-estimate first"
  ]
}
```

Never proceeds with a default/zero value for a missing estimate under any
circumstance (UX spec Step 7 "Prerequisites missing... never computed from
silent defaults").

**Computation** (`finance.service.ts`, all via `@sodeja/calc`): fit-out/opex
amounts are converted onto the project's `reporting_currency` first (via
`fx_usd_dop`, `409` if a conversion is needed but no rate is pinned — no
update endpoint sets this yet in the MVP slice). Month 0 is the fit-out
total as a one-time capex outlay (`-fitoutTotal`); months 1..horizon add a
constant `monthlyNet = revenue - opex` to the running cumulative cash.
Subtracting a cost range from a benefit range inverts the cost's
pessimistic/optimistic bound labels before combining (`subtractCostRange`) —
`Range<Money>.pessimistic`/`.optimistic` are structurally low/high, not
"good/bad for the business", exactly the same reasoning `capacity.service.ts`
applies to `seats = area / ratio`.

**Break-even** is computed per scenario, and — subtly — the bound direction
INVERTS again relative to the cash-amount direction: a lower break-even
month is the *better* outcome, and that comes from the cash series'
OPTIMISTIC trajectory (high revenue, low costs). So
`breakevenMonthLow` reads the series' `.optimistic` bound and
`breakevenMonthHigh` reads its `.pessimistic` bound. Any bound that never
crosses zero within the horizon is `null` — never `0`, never the horizon
length.

**Sensitivity** (`resultsJson.sensitivity`, mandatory per the UX spec) is a
real one-at-a-time computation: for each of revenue / opex / fit-out, the
other two are held at base while that line moves between its own low and
high bound, and the resulting break-even-month shift is measured. Ranked by
that shift when every line produced one; falls back to ranking by
terminal-cumulative-cash delta (always computable, one consistent currency
unit) when any line never reaches break-even in one of its variants —
`resultsJson.rankedBy` names which metric was used.

`resultsJson.disclaimer` always carries the non-dismissible "this is a
projection, not audited, not financial advice" caveat (risk L1).
`rule_pack_ids` is always `'{}'`. B-18 has since seeded `domain='permits'`
rule packs, but the projection consumes none of them — it reads
`content.parameter_value` (tax/labor rates) only, and a permits pack
contributes nothing to the arithmetic. It is not a stale empty array to be
backfilled.

## B-7 contract — `geo` (`src/geo/`)

Read-only, no auth/RLS (same posture as `catalog`'s `GET /business-types` —
`geo.*` is reference/ingested data, not user-owned).

- **`GET /geo/footprints/at?lon=&lat=`** — every `geo.building_footprint`
  containing the point (`ST_Contains`), zero/one/many. Zero means "no
  candidate" (the map UI falls through to a manual polygon draw); many means
  overlapping datasets, a real UX state, never collapsed to one.
- **`GET /geo/footprints?bbox=minLon,minLat,maxLon,maxLat`** — footprints
  intersecting a viewport bbox, capped at a 0.5° span and 2000 rows (generous
  sanity ceilings against an unbounded query, not a tuned viewport size).
- **`GET /geo/coverage?lon=&lat=`** — `{covered, adminAreaId, adminAreaName}`,
  checking `geo.admin_area` (`level='provincia'`) against the exact three
  launch-area province names (`LAUNCH_AREA_PROVINCES`,
  `src/geo/geo.repository.ts`) — the same three `content.jurisdiction` and
  `services/ingestion`'s B-9 grid job use, never a fourth hardcoded
  definition of "the launch area".

## B-9 contract — `market-study` (`src/market-study/`)

Module 1: population, competition, and a demand index within a radius of the
project's confirmed site — gated behind `geo.data_coverage_cell`'s real
coverage-tier signal (risk D3), which `services/ingestion`'s
`computeDataCoverage`/`computePopulationGrid` jobs populate.

**`POST /projects/:id/market-study?radiusM=`** (default `500`, per the UX
spec's Step 3 default; capped at `5000`). `409`s if the project's area is not
confirmed (B-7a gate) or has no business type set. Computes and **upserts**
`app.market_study` (one row per project — `project_id` is its primary key,
unlike `capacity_estimate`/`fitout_estimate`/`opex_estimate`'s append-only
history):

- `populationEst` — sum of `geo.population_grid.population_est` for every
  cell within `radiusM` meters of the confirmed centroid (`ST_DWithin`,
  whole cells counted, not clipped to the circle — same simplification
  `lib/grid.ts` documents for grid generation itself).
- `competitorCount` — count of `geo.poi_place` within the radius whose
  `category` (normalized at ingest time, B-5) matches the project's business
  type.
- `confidence` — the **worst** (lowest-ranked) `geo.data_coverage_cell.tier`
  among cells intersecting the radius; `'insuficiente'` if zero coverage
  cells exist there at all (a real, common outcome in a database where the
  B-9 ingestion jobs haven't been run yet for that area — not an error).
- `demandIndexLow/Base/High` — population per (dataset + manually-added)
  competitor, as a `Range<number>` (`@sodeja/calc`) banded by confidence
  (±10% `alta`, ±25% `media`, ±50% `baja`). **`null`** when `confidence ===
  'insuficiente'` or total competitors is zero — never a fabricated figure
  standing in for a number the system doesn't actually have grounds for.
- `censusYear` — from the most specific `geo.admin_area` intersecting the
  point that has a `geo.census_population` row (same resolution rule
  `computePopulationGrid.ts` uses, so the year always matches the census
  figure that actually produced `populationEst`).

**`populationEst`/`competitorCount` are ALWAYS real computed numbers** — the
`app.market_study` columns are `NOT NULL`. Suppressing the figure when
`confidence === 'insuficiente'` (UX spec Step 3: "Numbers suppressed, not
shown greyed") is a **presentation-layer** decision for whichever UI reads
this response — this endpoint does not null anything out itself. A future
frontend must apply that rule; it is not enforced here.

**`PATCH /projects/:id/market-study/manual-competitors`** — body `{ delta }`
(signed integer). Per the UX spec, manually-observed competitors are a
first-class, ongoing input (informal businesses are invisible to every
dataset — risk D2), not a fallback: `competitorsUserAdded` is preserved
across a recomputation (a `POST` never resets it), and factors into
`demandIndex`'s total-competitor denominator. `404`s if no market study has
been computed for the project yet.

## B-18 contract — `permits` (`src/permits/`)

**`GET /projects/:id/permits-checklist`** → `PermitChecklist`
(`@sodeja/schemas`). A pure read, like `layout`: the service computes nothing
itself, it calls `evaluatePermits` (`packages/rules/src/evaluate.ts`), which
fetches the jurisdiction chain plus every in-force `domain='permits'` rule
pack/rule/citation and hands them to B-10's pure `evaluatePermitRules`
interpreter.

**The response is non-exhaustive by construction and is not legal advice.**
`isExhaustive` is the Zod literal `false` — no future change can flip it by
accident — and `disclaimerEs` must be rendered as visible copy, never behind
a tooltip. `requirement` is `required | likely_required | not_applicable |
unknown` and must never gain a `compliant`/`cleared` member (risk L3): a
false all-clear can cost a user their fit-out capital. The non-exhaustiveness
is a legal fact, not a hedge — Ley 176-07 Art. 16, cited on the
municipal-licence item itself, says a licence from one public body never
exempts its holder from the others, and several real requirements were
deliberately left unseeded (see the header of
`packages/db/migrations/1785560000000_seed-permits-content.sql`).

`jurisdictionSlug` and `rulePackVersion` are per ITEM, not per checklist: one
response mixes national rules with municipal overrides that version
independently. The seeded example is `uso-suelo` — the Distrito Nacional's
"Certificación de Uso de Suelo" (Dirección de Planeamiento Urbano) versus
Santiago's "No Objeción al Uso de Suelo" (OMPU). The municipal row wins on
shared `code`, so the national default is replaced rather than listed
alongside it.

Facts passed to the interpreter are `{ businessTypeSlug }` and nothing else —
it is the only fact any seeded rule keys on (the two food-handling rules). A
fact this endpoint cannot supply is never faked: an absent fact makes a
conditional rule not fire, which is the safe direction, whereas a guessed one
manufactures a requirement.

Gated behind `requireConfirmedArea` (B-7a) like every estimate module — not
because permits are computed from the area, but because confirming the
location is where the project's jurisdiction is resolved, and a checklist for
the wrong municipality names offices that will not process the applicant.
`409` on an unconfirmed area, a null `jurisdiction_id`, or a null
`business_type_id`; `404` if the project is not the caller's.

A non-empty `failures` array from the interpreter means seeded content is
malformed, so the endpoint `500`s naming the offending rule codes (full
interpreter messages go to the log only) rather than serving a silently
shortened legal checklist.

`app.permit_checklist_item` stays EMPTY. That table is designed for a
materialized checklist with per-item `user_marked_done` tracking, and the
OpenAPI spec has a matching `PATCH`; both are deferred because they need a
product decision B-18 does not contain — when the checklist freezes, and what
happens to a user's ticked boxes once the underlying rule pack is superseded.
This endpoint recomputes on every call.

## B-20 contract — `legal` (`src/legal/`)

**`GET /legal/documents/:kind/current?locale=`** (locale defaults `es-DO`) —
`app.legal_document` reference content, no auth (same posture as `GET
/business-types`; see legal.repository.ts's doc comment for why RLS does
not apply here). `400` for an invalid `:kind`; `404` when no document of
that `kind`/`locale` has been seeded.

**This is a deliberately minimal slice**, not the full B-20 backlog item.
The following are NOT built here, and the reason is the same for all of
them: they need a real login step (UX spec Step 0 — email/Google sign-in),
which does not exist anywhere in this codebase yet (every route still reads
`userId` from the `x-user-id` header placeholder). Building any of them now
would mean half-implementing an acceptance/consent-tracking flow with
nothing real to attach it to:

- `app.legal_acceptance` — versioned ToS/privacy acceptance tracking.
- Ley 172-13 granular consent (`app.consent`: precise location, analytics,
  marketing, cross-border transfer).
- Export/delete-my-data endpoints (Ley 172-13 data-subject rights).

Only ONE `app.legal_document` row is seeded
(packages/db/migrations/1785570000000_seed-disclaimer-legal-document.sql):
`kind='disclaimer', version='1', locale='es-DO'`. Its `body_md` is a
GENERIC, CONSERVATIVE placeholder — informational/estimative output, not
audited, not professional advice, no warranty, provisional — written
WITHOUT citing any DR law and WITHOUT claiming legal review took place
(P0-4, "Engage DR contador + lawyer," is still open — see the migration's
own header for the full reasoning). It exists to satisfy B-19's schema
constraint honestly, not to substitute for real legal review.

## Architectural rules

**Cross-module calls go through service interfaces only.** No module reaches
into another's tables. This discipline is what makes a later extraction cheap,
and it is free to maintain today.

**Nothing else gets extracted on speculation.** Extraction triggers are:
independent scaling need, a distinct availability SLA, a separate owning team, or
a specific measured bottleneck. "It feels big" is not a trigger.

**The `providers` module is the only code that holds an external API key.**
Server-side proxy with hard spend caps, rate limiting, and billing alerts
(risks T2, F1). Keys never reach a browser or an APK.

**Free and local tiers only** (product decision 2026-07-25). Every provider —
map tiles, POI, object storage, cache, error tracking — sits behind one
interface selected by an environment variable, so a free source swaps for a paid
one without an API change:

| Seam | Env var | MVP default |
|---|---|---|
| Tiles | `TILE_PROVIDER` | `pmtiles-local` (OSM) |
| POI | `POI_PROVIDER` | `overture-local` |
| Storage | `STORAGE_DRIVER` | `filesystem` |
| Cache/queue | `CACHE_DRIVER` | `memory` or local Redis |
| Errors/logs | `TELEMETRY_DRIVER` | `stdout-json` |

No paid plan, subscription, or quota increase may be provisioned without
explicit product-owner approval. GCP usage is permitted **only** within the
existing $300 credit balance. If a provider returns a quota or billing error,
the correct response is to surface it and stop — never to enable billing.

**No business calculation in a controller or service.** If it produces a number a
user sees, it lives in `@sodeja/calc`.

## Related backlog items

B-1, B-2, B-3, B-7a, B-11, B-11a, B-12, B-13, B-14, B-15, B-17, and every other module item B-7 through B-20.
