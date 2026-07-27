# SODEJA — System Architecture

Status: draft from planning phase; Phase 0 technical package (repo structure, DB schema, API contracts) will refine/implement this. See task tracking for progress.

## One-line summary

A modular TypeScript monolith on Postgres + PostGIS, with exactly three things carved out from day one (Python geo/ML service, PDF worker, ingestion jobs).

```
Web (Next.js + MapLibre GL JS)      Android (React Native/Expo + MapLibre + SQLite)
        └──────────── @sodeja/calc (shared TS) ────────────┘
                            │ HTTPS / JSON + sync outbox
                            ▼
        API — modular monolith (NestJS, one module per product module)
        projects · sim · capacity · finance · compare · costs · rules-eval · auth
                 @sodeja/calc  ·  @sodeja/rules  ·  @sodeja/schemas
                            │
        ┌───────────────────┼────────────────────┐
   Postgres+PostGIS     Redis queue         Object storage
      (+pgvector)            ├──► PDF worker (Playwright)
                             ├──► Ingestion jobs (footprints, POI)
                             └──► Geo/ML service (Python) ◄── Phase 3 only
```

## Client

TypeScript across web and mobile. Rationale: the financial engine (`@sodeja/calc`) must produce byte-identical results on web, on Android offline, and in the exported PDF. A split-language stack forces either a ported engine (two sources of truth for numbers users may take to a bank) or an online-only Android app. Expect ~60-70% logic reuse, ~0% UI reuse.

If the team already writes Dart, Flutter is defensible instead — but budget a Dart port of the engine behind a shared conformance test suite in CI. **This is an open decision for the product owner** (team language skills).

## Backend

Modular monolith, not microservices. NestJS modules map 1:1 onto the 13 product modules. Simulator, capacity, projection, comparison, costs, tax, and regulations stay together: they are synchronous, CPU-trivial, share a project aggregate, and always change together together.

**Carved out from day one** (different runtime, resource profile, or failure mode): Python geo/ML service, Chromium-based PDF worker, scheduled ingestion jobs. Extraction triggers for anything else: independent scaling need, distinct availability SLA, separate owning team, or a measured bottleneck — not "it feels big."

## Maps & geospatial

MapLibre GL JS, so the tile provider is a config value, not an SDK rewrite. Base map from self-hosted Protomaps/PMTiles built from OSM — free, and the same artifact that becomes the offline pack. **Satellite imagery is deferred**: paid tile providers (Mapbox, MapTiler) are not provisioned, so the MVP ships with OSM base tiles only. Footprint outlines render as vector geometry over the base map, which is sufficient for tap-to-select; satellite is a visual aid, not a functional dependency. Footprints come from open datasets; POI source pending the Phase 0 coverage spike (Overture Places vs. Google Places Aggregate — see [SODEJA_DATA_SOURCES.md](./SODEJA_DATA_SOURCES.md)). Provider access is server-side proxied — keys never ship in the APK.

**Hard licensing boundary, encoded in the data layer from day one:**
- Storable: Open Buildings, Overture Places, Overture/OSM buildings (ODbL — share-alike needs legal review), ONE census, IDE-RD.
- Never persist: Google Places content beyond `place_id` (indefinite) and coordinates (≤30 days), per that API's terms.

Physically separate stores plus per-record attribution metadata — mixing these in one table creates an expensive-to-unwind compliance problem.

## `@sodeja/calc` — the financial/capacity engine

Pure TypeScript library. No I/O, no network, no DB access, no clock, no randomness.

- Versioned and immutable: every stored projection records `engineVersion` plus a full input snapshot, so a report regenerates identically months later. Never silently recompute history with a new engine version.
- All rates injected, never hardcoded constants — the engine knows *how* to compute, never *what the current rate is*.
- Dual-currency from day one: every monetary value is `{amount, currency}` with explicit FX on the scenario (DR commercial leases are frequently quoted in USD while revenue/payroll are DOP).
- Property-based tests on invariants, plus golden-file regression tests.

## Rules and rates as data

A rate change must be a content edit, never a deploy. Versioned `rule_pack` (hierarchical jurisdiction: national → province → municipio), declarative `rule` (JSONLogic or a constrained non-Turing-complete DSL editable by non-engineers), dated `parameter_table` read by `asOfDate`, and mandatory `citation` on every rule (source URL, document, article, date retrieved). Draft → review → publish workflow, append-only. Every user-facing answer renders with its citation, effective date, and rule-pack version.

## Auth & data access

Supabase Auth (free tier) or a local equivalent in development, with Postgres row-level security as the actual enforcement layer, so an application-code authorization bug still cannot leak another user's project data.

**Tenancy (decided 2026-07-25): minimal groundwork, functionally single-tenant.** Every project belongs to an organization; one personal org is created automatically per account; RLS checks org scope alongside user scope. Organization management, invitations, roles, and billing are explicitly **not** built. The rationale is narrow: `org_id` touches the RLS policy of every tenant-owned table, so retrofitting it after launch means migrating a security boundary across live user data. Policies call a single `app.current_org_ids()` function rather than inlining the ownership test — when real multi-tenancy arrives, that function body changes and no policy is rewritten.

## Offline (Android)

SQLite-first with an idempotent outbox queue; last-write-wins per project (no CRDTs — projects are single-owner, the complexity is not justified). Downloadable DR-wide PMTiles pack. `@sodeja/calc` runs entirely on-device. Degrades gracefully with a stated reason when offline: POI lookups, PDF generation, and rule-pack refresh require connectivity.

## Infrastructure posture — free and local first (decided 2026-07-25)

**No paid service or recurring subscription is provisioned until the product owner explicitly enables it.** Target hosting cost at MVP scale is **$0**.

| Concern | MVP (free/local) | Paid equivalent, if later approved |
|---|---|---|
| Database | Local Postgres + PostGIS (Docker), or Supabase free tier | Supabase Pro / managed Postgres |
| Auth | Supabase free tier, or local `auth.users` + `auth.uid()` stub | Supabase Pro, Clerk |
| Cache / queue | Local Redis, or in-memory | Managed Redis |
| Base map tiles | OSM via self-hosted PMTiles | Mapbox / MapTiler |
| Satellite imagery | **Not shipped** — OSM base only | Mapbox / MapTiler satellite |
| POI | Overture (open data, pending P0-1) | Google Places API |
| Object storage | Local filesystem, or GCS within the existing $300 GCP credit | GCS / S3 / R2 paid |
| Error tracking + logs | Local structured logs, self-hosted or free-tier collector | Sentry paid plan |

Google Cloud services may be used **only within the existing $300 credit balance**, with no other cloud spend. Whenever a plan upgrade, quota increase, or credit top-up would be needed, that is a **stop-and-ask**: it requires product-owner approval before any charge-incurring action.

**Every external provider sits behind a configurable interface selected by environment variable** — map tiles, POI source, object storage, cache, and error tracking each have one seam and one env var. This is what makes the free-tier decision reversible: swapping in a paid provider is configuration, not a rewrite. It is also the same abstraction risk T2 already required for provider-dependency reasons, so it costs nothing extra.

Two consequences worth stating plainly rather than discovering during Phase 1: the MVP map has **no satellite view**, which changes what Step 1 of the primary UX flow looks like; and free-tier database limits (row counts, storage, connection caps) need checking against the footprint ingestion volume in B-4 before that item starts.

## Explicitly avoided (for this stage)

Kubernetes, service mesh, Kafka, data warehouse, custom tile server, self-hosted auth, microservices — plus, now, any paid managed service.

## Open architectural decisions

- Overture Places vs. Google Places Aggregate as the POI source of record — pending the Phase 0 coverage spike, and material to unit economics (see [SODEJA_DATA_SOURCES.md](./SODEJA_DATA_SOURCES.md)). Note the free-tier posture raises the stakes: if Overture coverage is insufficient, the fallback is a paid API, which is now a product-owner decision rather than a technical one.

**Resolved 2026-07-25:** tenant-scoping (minimal groundwork now — see Auth & data access) and paid-service provisioning (free/local first — see Infrastructure posture).
