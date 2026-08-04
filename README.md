# SODEJA

Web and Android application for **geographic business evaluation in the Dominican Republic**: pick a commercial space on a map and get an area estimate, nearby competition, capacity and fit-out cost ranges, an operating-cost breakdown, a financial projection, and a permits checklist.

The MVP is one complete vertical slice — an *Estudio de Ubicación Comercial* — scoped to Distrito Nacional, Santo Domingo province and Santiago, and to 4–6 business types (restaurante, colmado, ferretería, salón, minimarket). Every number ships as a **range with a visible, editable, provenance-tagged assumption**, never as a point estimate.

## Architecture

A modular TypeScript monolith on Postgres + PostGIS, with three things carved out from day one (Python geo/ML service, PDF worker, ingestion jobs).

```
Web (Next.js + MapLibre GL JS)      Android (React Native/Expo — Phase 1 placeholder)
        └──────────── @sodeja/calc (shared TS) ────────────┘
                            │ HTTPS / JSON
                            ▼
              API — modular monolith (NestJS)
        projects · capacity · costs · finance · geo · catalog
                            │
        ┌───────────────────┼────────────────────┐
   Postgres + PostGIS   Redis queue        Object storage
                             ├──► PDF worker (Playwright)
                             ├──► Ingestion jobs (footprints, POI, census)
                             └──► Geo/ML service (Python) ◄── Phase 3 only
```

## Repository layout

| Path | What it is |
|---|---|
| `apps/api` | NestJS modular monolith — one module per product module |
| `apps/web` | Next.js front end, MapLibre GL JS map, polygon-draw fallback |
| `apps/mobile` | React Native/Expo companion — placeholder, Phase 1 |
| `packages/calc` | Pure financial/capacity engine: no I/O, versioned, golden-file tested |
| `packages/rules` | Rules and rates as versioned data (JSONLogic), citation-mandatory |
| `packages/db` | Postgres schema, migrations, connection pool, RLS session helpers |
| `packages/providers` | Provider registry + adapters (tiles, geocoding, POI) with rate limiting, resilience and cost metering |
| `packages/observability` | Structured logging |
| `services/ingestion` | Jobs for building footprints, admin geometry, census and POI data |
| `services/pdf-worker`, `services/geo-ml` | Carved-out runtimes |
| `specs/` | OpenAPI contract, DB schema, UX flows |
| `docs/` | Master plan, architecture, data sources, risks, MVP backlog |

## Design decisions worth knowing

- **No paid service is provisioned.** Target hosting cost at MVP scale is $0 — local Postgres, self-hosted OSM PMTiles, open data. Every external provider sits behind one interface and one env var, so swapping in a paid provider is configuration, not a rewrite.
- **No satellite imagery** in the MVP; footprint outlines render as vector geometry over OSM base tiles.
- **`@sodeja/calc` is pure.** All rates are injected, values are dual-currency `{amount, currency}`, and every stored projection records its `engineVersion` plus a full input snapshot so a report regenerates identically months later.
- **Rate changes are content edits, not deploys** — versioned rule packs with mandatory citations and effective dates.
- **A hard data-licensing boundary** is encoded in the data layer: open datasets are storable, Google Places content is not persisted beyond what its terms allow.

## Getting started

Requires Node ≥ 22, pnpm 11 and Docker.

```bash
pnpm install
cp .env.example .env
docker compose up -d       # Postgres + PostGIS
pnpm build
pnpm test
pnpm dev
```

## Documentation

- [`docs/SODEJA_MASTER_PLAN.md`](docs/SODEJA_MASTER_PLAN.md) — product scope, the 13 modules, phasing
- [`docs/SODEJA_ARCHITECTURE.md`](docs/SODEJA_ARCHITECTURE.md) — system architecture and its rationale
- [`docs/SODEJA_DATA_SOURCES.md`](docs/SODEJA_DATA_SOURCES.md) — data-source verification and licensing
- [`docs/SODEJA_RISKS.md`](docs/SODEJA_RISKS.md) — risk register
- [`docs/SODEJA_MVP_BACKLOG.md`](docs/SODEJA_MVP_BACKLOG.md) — dependency-ordered backlog

## Status

In development. Legal and tax observations in the planning documents are risk-planning, not legal advice, and several data figures carry unresolved conflicts — see the data-sources document before relying on any number.
