# `apps/web` — SODEJA Web Application

**Status: placeholder. No implementation, no dependencies installed.**

Primary user surface for the MVP. The "Estudio de Ubicación Comercial" flow
(see [`specs/ux/flows.md`](../../specs/ux/flows.md)) is a desktop-first,
map-and-document experience — large screens, side-by-side map and numbers,
printable output. That is why web leads and Android follows.

## Intended stack (Phase 1)

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router) + React + TypeScript |
| Styling | Tailwind + shadcn/ui |
| Map | MapLibre GL JS; tiles from self-hosted OSM PMTiles. **No satellite layer in the MVP** — paid tile providers are not provisioned |
| Validation | `@sodeja/schemas` (Zod), shared with the API |
| Calculations | `@sodeja/calc`, executed client-side for instant recalculation |
| i18n | Spanish (DR) first; copy is externalised from day one |

## Boundaries

- **Never holds a provider API key.** All map/tile/POI provider access is
  server-side proxied (risk T2/T7). The browser talks only to the SODEJA API.
- **Never re-implements a calculation.** If a number appears on screen, it came
  from `@sodeja/calc`. Duplicating a formula here is how Module 7 and Module 8
  start disagreeing about the same site (risk T6).
- **Never renders a bare number.** Every figure carries its range, its
  provenance tag, and — where relevant — its data-confidence score.

## Related backlog items

B-1 (monorepo/CI), B-7 (map UI, tap-to-select, manual polygon fallback),
B-9, B-11 through B-19.
