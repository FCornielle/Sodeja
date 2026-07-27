# `apps/api` — SODEJA API (Modular Monolith)

**Status: placeholder. No implementation, no dependencies installed.**

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
| `auth` | — | Supabase JWT verification; RLS is the real enforcement layer |
| `projects` | — | The project aggregate; owns assumptions |
| `geo` | 2, 3 | Footprint lookup, polygon validation, coverage scoring |
| `market-study` | 1 | Population + competition counts + confidence score |
| `catalog` | 5 | Business types and their parameter sets |
| `layout` | 4 | Typology ratio templates |
| `capacity` | 6 | Thin wrapper over `@sodeja/calc` |
| `costs` | 9, 10 | Fit-out and operating cost estimates |
| `finance` | 7 | Financial projection; the integration point |
| `rules` | 12 | Permit checklist evaluation |
| `reports` | 13 | Enqueues work; does not render |
| `legal` | — | ToS acceptance, Ley 172-13 consent, export/delete |
| `providers` | — | Server-side proxy for all external map/POI providers |

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

B-1, B-2, B-3, and every module item B-7 through B-20.
