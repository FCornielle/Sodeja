# `apps/api` — SODEJA API (Modular Monolith)

**Status: `providers` (B-3), `catalog` (B-11), `projects` (B-11a + B-7a's
area-confirmation slice), `capacity` (B-12) and `costs` (B-14 fit-out) are
implemented. Every other module below is still a placeholder.**

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
| `projects` | — | **Implemented (B-11a + B-7a), minimal.** `POST /projects` (create only — no update/delete/list) + the assumptions sub-resource + `PUT /projects/:id/location` (the area-confirmation gate). See "B-11a contract" and "B-7a contract" below |
| `geo` | 2, 3 | Not built. Footprint lookup, polygon validation, coverage scoring |
| `market-study` | 1 | Not built. Population + competition counts + confidence score |
| `catalog` | 5 | **Implemented (B-11).** `GET /business-types` — see "B-11 contract" below |
| `layout` | 4 | Not built. Typology ratio templates |
| `capacity` | 6 | **Implemented (B-12).** `POST /projects/:id/capacity-estimate` — see "B-12 contract" below |
| `costs` | 9, 10 | **Implemented (B-14 fit-out; B-15 opex next).** `POST /projects/:id/fitout-estimate` — see "B-14 contract" below |
| `finance` | 7 | Not built (B-17). Financial projection; the integration point |
| `rules` | 12 | Not built. Permit checklist evaluation |
| `reports` | 13 | Not built. Enqueues work; does not render |
| `legal` | — | Not built. ToS acceptance, Ley 172-13 consent, export/delete |
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

**`PUT /projects/:id/location`** — body `{ areaSqm, centroidLon, centroidLat }`
(`ConfirmProjectLocationRequestSchema`). Idempotent upsert into
`app.project_location`; always writes `area_source = 'user_entered'` (the
only source reachable without the map UI — B-7/B-8, not built) and
`area_confirmed_at = now()`. `404` if the project does not exist or is not
owned by the caller; `400` on an out-of-range lon/lat. Returns:

```ts
// ProjectLocation (@sodeja/schemas project.ts)
{
  projectId: string;       // uuid
  areaSqm: number;
  areaSource: "footprint_dataset" | "user_drawn" | "user_entered"; // always "user_entered" from this endpoint
  areaConfirmedAt: string; // ISO datetime
  centroidLon: number; centroidLat: number;
  updatedAt: string;
}
```

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

## B-14 contract — `costs` fit-out (`src/costs/`)

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

B-1, B-2, B-3, B-7a, B-11, B-11a, B-12, B-14, and every other module item B-7 through B-20.
