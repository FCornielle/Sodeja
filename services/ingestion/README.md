# `services/ingestion` — Scheduled Data Ingestion Jobs

**Status: placeholder. No implementation.**

Carved out of the monolith **from day one**: these jobs are long-running,
memory-hungry, and must be able to fail without taking the API down. A footprint
import that OOMs should not return 503 to a user drawing a polygon.

## Datasets in Phase 1 scope

| Job | Source | Target table | Cadence |
|---|---|---|---|
| Building footprints | Google Open Buildings V3, Microsoft GlobalML | `geo.building_footprint` | One-off, then on dataset release |
| POI / places | Overture Places *(pending P0-1 coverage spike)* | `geo.poi_place` | Monthly |
| Admin geometry | IDE-RD `RD_SECCIONES` | `geo.admin_area` | Rare |
| Census population | ONE Censo 2022 | `geo.census_population` | Rare |
| Population grid | Derived from the two above | `geo.population_grid` | After either input changes |
| Data-coverage scoring | Derived from footprint + POI density | `geo.data_coverage_cell` | After either input changes |

## Non-negotiable rules

**Idempotent and re-runnable.** Every job is safe to run twice. Loads are
staged then swapped, never mutated in place, so a partial failure cannot leave
the map half-populated.

**Licence tier is enforced at write time, not documented in a wiki.** These jobs
write only to the `geo` schema, which holds storable, redistributable data.
Nothing here may write to `ephemeral` (see
[`specs/db/schema.sql`](../../specs/db/schema.sql)). Per-record
`source`, `source_license`, and `source_vintage` are `NOT NULL` — an unattributed
row is a compliance defect (risks L4, L6).

**Vintage is surfaced, not hidden.** Every ingested dataset records its vintage
so the UI can display it. Risk D2 is that a 2022 census silently reads as
current; the mitigation only works if the date reaches the screen.

## What must never be ingested

Google Places content beyond `place_id` and coordinates, and any content derived
from commercial satellite tiles. Both violate provider terms and put the API key
at risk (risk L4). The `ephemeral` schema exists precisely so that the
short-lived, non-redistributable tier is physically separate from this one.

## Related backlog items

B-4 (footprints), B-5 (POI), B-6 (census + sections).
