# `services/ingestion` — Scheduled Data Ingestion Jobs

**Status: B-4 (building footprints), B-6 (admin geometry + census), and B-5
(POI) are implemented.** The derived population-grid / data-coverage jobs are
not — see "Not yet built" below.

Carved out of the monolith **from day one**: these jobs are long-running,
memory-hungry, and must be able to fail without taking the API down. A
footprint import that OOMs should not return 503 to a user drawing a polygon.

## What's implemented

| Job | Source(s) | Target table | Entry point |
|---|---|---|---|
| Admin geometry | OCHA COD-AB on HDX (`dom_admin_boundaries.geojson.zip`) | `geo.admin_area` | `pnpm ingest:admin-areas` |
| Census population | ONE Censo 2022 (manual REDATAM extract — see below) | `geo.census_population` | `pnpm ingest:census` |
| Building footprints | Microsoft GlobalML (primary) + Google Open Buildings V3 (cross-check/gap-fill) | `geo.building_footprint` | `pnpm ingest:footprints` |
| POI (places) | Overture Places, live bbox query via DuckDB against public S3 Parquet | `geo.poi_place` | `pnpm ingest:poi` |

Each job is a thin CLI wrapper (`src/cli.ts`) around a `run*Job(logger)`
function in `src/jobs/`, which itself wraps a pure, DB-testable
`ingest*(client, rows, logger)` function. Sources (`src/sources/`) fetch and
stream-parse; transforms (`src/transform/`) are pure mapping functions with no
I/O. This split is what makes the parsers unit-testable without a network call
and the DB writes testable without re-implementing HTTP fetch/parse logic.

## Non-negotiable rules

**Idempotent and re-runnable.** Every job stages fully-parsed rows into a
session-scoped Postgres `TEMP TABLE` (`src/lib/tempTable.ts`) — outside any
production-table transaction — and only then swaps them into `geo.*` inside a
single `BEGIN`/`COMMIT` (delete-by-source, insert-from-staging). If
fetching/parsing fails partway through, the temp table is simply dropped and
`geo.*` was never opened for writing. Re-running a job with the same input
produces the same end state, not duplicates.

**Licence tier is enforced at write time.** These jobs write only to the
`geo` schema. Per-record `source`, `source_license`, and `source_vintage` are
set on every row and are `NOT NULL` in the schema — an unattributed row is a
compliance defect, not untidy metadata (risks L4, L6).

**Vintage is surfaced, not hidden.** `source_vintage` always reflects the
upstream dataset's own vintage (MS GlobalML's build date, OCHA's
`valid_on`, ONE's census year) — never the date the job happened to run.

## What must never be ingested

Google Places content beyond `place_id` and coordinates, and any content
derived from commercial satellite tiles. Neither applies to this package's
scope (footprints, admin geometry, census, POI) — POI comes from Overture
Places, not Google, and lands in `geo.poi_place` for exactly that reason
(`specs/db/schema.sql`'s comment on that table). The `ephemeral` schema
exists for a per-request Google Places proxy path that the P0-1 spike's
findings mean B-5 did **not** need to build — see "POI / places (B-5)"
below.

## Building footprints (B-4)

- **Primary: Microsoft GlobalML** (`src/sources/msGlobalMl.ts`). Fetches the
  real, currently-live `dataset-links.csv` manifest, filters to
  `MS_GLOBALML_REGION` (default `DominicanRepublic`, 18 quadkey tiles,
  ~179MB total per the manifest), and streams each tile — despite the
  `.csv.gz` extension, the body is gzip-compressed newline-delimited GeoJSON,
  confirmed by downloading a real tile during development. `confidence: -1`
  (Microsoft's "not applicable" sentinel — every row in the 2026-02-03 DR
  build reports it) is normalized to `NULL` to satisfy the schema's
  `BETWEEN 0 AND 1` CHECK.
- **Cross-check/gap-fill: Google Open Buildings V3** (`src/sources/openBuildings.ts`).
  Google does not publish one stable, predictable bulk-download manifest URL
  per country the way Microsoft does (several candidate URLs were probed
  during development and returned 404). Rather than hardcode a guess, this
  source reads an explicit `OPEN_BUILDINGS_SOURCE_URLS` (comma-separated
  gzipped CSV shard URLs) from the operator. **If unset, the footprint job
  logs a clear warning and skips this source** — it is documented as
  cross-check/gap-fill, not primary, so its absence does not fail B-4.
  Parses Google's documented columns (`latitude, longitude, area_in_meters,
  confidence, geometry, full_plus_code`); `geometry` (WKT) is converted to
  GeoJSON (`src/lib/wkt.ts`) so both sources share one SQL insert path.
- `area_sqm` is **always** computed by the job via `ST_Area(geom::geography)`
  at insert time (never trusted from either source's own area field), per
  `specs/db/schema.sql`'s comment on `geo.building_footprint.area_sqm`.
- `admin_area_id` is resolved by a centroid-in-polygon spatial join
  (`ST_Contains`) against whatever `geo.admin_area` rows exist at ingestion
  time, picking the smallest-area (most specific) containing polygon when
  several nest. `NULL` if nothing contains the centroid — an accepted
  outcome, not an error.
- License: MS GlobalML is CDLA-Permissive-2.0. Open Buildings V3 is
  dual-licensed CC BY 4.0 / ODbL v1.0; this job records **CC BY 4.0** —
  `SODEJA_ARCHITECTURE.md`'s licensing-boundary section flags ODbL's
  share-alike obligation as needing legal review before use, so the
  attribution-only option is used until that review happens.

## Admin geometry (B-6, part 1)

`IDE-RD RD_SECCIONES` publishes zero layers (confirmed dead —
`docs/SODEJA_DATA_SOURCES.md`). This job uses **OCHA's Common Operational
Dataset – Administrative Boundaries (COD-AB)** for the Dominican Republic
instead (`src/sources/ochaAdminAreas.ts`), fetched from its real HDX resource
URL as a GeoJSON zip and unzipped in-memory (`adm-zip`).

OCHA's ADM levels don't line up 1:1 with `geo.admin_area.level`'s five-value
enum. The mapping (documented in full in `src/transform/adminAreaRow.ts`):

| OCHA level | Feature count | Mapped to |
|---|---|---|
| ADM0 (country) | 1 | `pais` |
| ADM1 (planning region) | 10 | **not loaded** — no equivalent tier in the schema |
| ADM2 (province) | 32 | `provincia` |
| ADM3 (municipio) | 155 | `municipio` |
| ADM4 (distrito municipal) | 386 | `seccion` (closest available — OCHA's finest published level is still coarser than DR's true sección/barrio units; `barrio` is never populated by this job) |

`parent_id` is resolved in a second pass after all rows are inserted (it's a
self-referencing FK, so a child's parent may not have an `id` yet within the
same insert), joined by `geo.admin_area.code` against each row's parent
pcode — which OCHA gives directly as `adm{N}_pcode` properties on every
feature, so no manual prefix-string arithmetic is needed.

## Census population (B-6, part 2)

**ONE Censo 2022 has no API.** It lives in REDATAM and censos.gob.do has been
observed returning HTTP 522 (`docs/SODEJA_DATA_SOURCES.md`). This job cannot
fetch census data — it only loads a **structured extract a human has already
produced**.

### Manual extraction steps (required before running this job for real)

1. Go to ONE's REDATAM instance (redatam.one.gob.do at time of writing;
   confirm the current URL, since censos.gob.do has been intermittently
   down).
2. Run a tabulation of population and households by the admin level you need
   (e.g. by province, by municipio) for Censo 2022.
3. Export the result and reshape it into a CSV with these columns:
   `admin_level,admin_area_code,population,households,census_year[,source][,source_vintage]`
   - `admin_level` — one of `pais`/`provincia`/`municipio`/`seccion`/`barrio`.
   - `admin_area_code` — must match the `code` already loaded into
     `geo.admin_area` by the admin-area job above (run that job first).
   - `households` may be blank; `source`/`source_vintage` default to
     `"ONE Censo 2022"` / `2022-01-01` if omitted.
4. Set `CENSUS_EXTRACT_CSV_PATH` to the file's path and run
   `pnpm ingest:census`.

If any row's `(admin_level, admin_area_code)` doesn't resolve to an existing
`geo.admin_area` row, the **entire batch fails** (no partial upsert) — see
`src/jobs/ingestCensusPopulation.ts`.

`fixtures/census-extract-FIXTURE.csv` is a 3-row fixture for tests only — the
national totals (population 10,760,028, households 4,418,619) are the real,
verified ONE Censo 2022 figures, but the province/municipio rows are an
**arbitrary split**, not real sub-national data. It exists purely so the
loader is exercisable in CI without a manual extraction. Do not load it
against a real deployment.

## POI / places (B-5)

The P0-1 spike (`docs/SODEJA_DATA_SOURCES.md`, 2026-07-31) measured — via
live DuckDB queries against the real, public Overture S3 Parquet release,
not an estimate — substantial POI density in Santo Domingo and Santiago,
and recommended B-5 proceed as straightforward warehouse ingestion into
`geo.poi_place` for those two metro areas, rather than the proxied/ephemeral
path (`ephemeral.poi_provider_cache` + a B-2a retention reaper). That is
what this job does; `ephemeral.poi_provider_cache` remains unused by this
package, kept only as the documented fallback if a future ground-truth pass
(B-22) shows Overture's urban-core numbers don't hold up.

- **Source: Overture Places**, queried live via the `duckdb` npm package
  (`src/sources/overturePlaces.ts`) — `spatial` + `httpfs` extensions,
  `read_parquet('s3://overturemaps-us-west-2/release/<release>/theme=places/type=place/*', ...)`,
  no AWS credentials configured (DuckDB's httpfs defaults to an anonymous
  request against the public bucket), no full-dataset download. Same
  methodology the P0-1 spike used and live-verified; re-verified again
  during B-5 development. `Connection#stream` (an async-iterable query
  result) is used instead of `#all` so rows are yielded as they arrive
  rather than buffering tens of thousands of rows in memory at once.
- **Geography**: bbox-scoped, not `ST_Contains` against `geo.admin_area` —
  `geo.admin_area` is not guaranteed to hold real, full-DR OCHA polygons at
  ingestion time (B-6's own admin-area job requires a live fetch too, and
  this package's tests only ship a small single-province fixture chain), so
  a bbox is the self-contained, always-available scoping mechanism. Two
  bboxes, both wider than the P0-1 spike's tight "urban core" measurement
  boxes to reasonably cover the full target administrative areas: one
  spanning Distrito Nacional + the Santo Domingo province ring around it,
  one spanning the Santiago municipio. Both were live-verified during B-5
  development (see "Real row counts" below) and are overridable via
  `OVERTURE_SD_BBOX` / `OVERTURE_SANTIAGO_BBOX`
  (`"minLon,maxLon,minLat,maxLat"`) without a code change. `admin_area_id`
  is still resolved per row, the same `ST_Contains` centroid-style join
  `ingestBuildingFootprints.ts` uses — but as denormalized enrichment only,
  never as what decides which rows get inserted.
- **Category mapping**: `categories.primary` → `content.business_type.slug`,
  via a narrow, rule-based mapping in `src/transform/poiPlaceRow.ts`
  (`mapOvertureCategory`) — `restaurant`/`*_restaurant` → `restaurante`,
  `convenience_store` → `colmado`, `grocery_store` → `minimarket`,
  `hardware_store` → `ferreteria`, `*_salon` → `salon`. Deliberately does
  **not** force adjacent-but-different categories into a mapping (e.g.
  `supermarket`, `computer_hardware_company`, `beauty_and_spa` all stay
  unmapped) — see that function's doc comment for the full reasoning per
  business type. `raw_category` always keeps Overture's original value,
  even when `category` is null.
- **Confidence and category are never filtered at ingestion time.** Per the
  spike's explicit recommendation, both are staged and written as-is —
  low-confidence and non-commercial-category (church, landmark, etc.) rows
  are kept, not silently dropped. An optional, documented,
  `OVERTURE_MIN_CONFIDENCE` env var (a float in `[0, 1]`) can apply a floor
  at query time if a future deploy needs to bound row count — unset by
  default, since 42,906 + 8,421 rows is not large enough to need one.
- **License**: Overture Places licensing is per-contributor
  (`docs/SODEJA_DATA_SOURCES.md` table (a): "mixed per source: most
  contributors CDLA-Permissive-2.0, Foursquare Apache 2.0, AllThePlaces
  CC0 — all storable/commercial"), and the public Parquet release has no
  practical per-row contributor/license column. `OVERTURE_PLACES_LICENSE`
  in `src/transform/poiPlaceRow.ts` is therefore a single summary string
  naming that mixed-but-all-storable posture, with a code comment
  explaining why a single field holds a summary rather than a per-row fact.
- `geo.poi_place.confidence` is a schema addition this job needed —
  `specs/db/schema.sql` didn't have it (it predates the P0-1 spike's
  finding that confidence matters). Added via
  `packages/db/migrations/*_add-poi-place-confidence.sql`
  (`ALTER TABLE geo.poi_place ADD COLUMN confidence numeric(4,3) CHECK
  (confidence BETWEEN 0 AND 1)`, nullable), mirroring
  `geo.building_footprint.confidence` exactly.

### Real row counts (live-verified during B-5 development)

Both bboxes were queried live against the real `2026-07-22.0` Overture
release while building this job (not a fixture-only claim):

| Area | Bbox | Places |
|---|---|---|
| Distrito Nacional + Santo Domingo province | `-70.2,-69.52,18.3,18.7` | 42,906 |
| Santiago | `-70.8,-70.55,19.35,19.55` | 8,421 |

Combined confidence distribution across both boxes: `>=0.9` 4,437 (12.0%),
`0.7–0.9` 10,084 (27.2%), `0.5–0.7` 12,421 (33.5%), `<0.5` 10,160 (27.4%) —
consistent with the P0-1 spike's national-scale finding that a majority of
DR records sit below 0.7 confidence, which is exactly why `confidence` is
kept as a first-class column rather than filtered away here.

## Fixtures — what's real vs. synthetic

| Fixture | Status |
|---|---|
| `fixtures/ms-globalml-sample.geojsonl` | Real — 5 lines from an actually-downloaded MS GlobalML tile (`RegionName=DominicanRepublic`, `quadkey=032211023`, build `2026-02-03`) |
| `fixtures/ocha-admin{0,2,3,4}-sample.geojson`, `ocha-admin-boundaries-sample.zip` | Real properties/pcodes/names/hierarchy from an actually-downloaded OCHA COD-AB zip (one real parent→child chain: país → Provincia Duarte → Municipio Arenoso → its 3 secciones); geometries for `pais`/`provincia`/`municipio` are simplified to each real polygon's bounding box to keep fixture size small — `seccion` geometries are likewise bbox-simplified for the same reason |
| `fixtures/open-buildings-sample.csv` | **Synthetic.** Google does not publish a stable bulk-download URL for this job to pull a real sample from (see above) — this fixture matches the real, documented column schema with plausible DR coordinates, not an actual download |
| `fixtures/census-extract-FIXTURE.csv` | **Mixed.** National totals are real; sub-national split is arbitrary (see above) |
| `fixtures/overture-places-sample.ndjson` | **Real.** 38 rows pulled live from the real Overture S3 Parquet release inside the Distrito Nacional bbox during B-5 development — real GERS ids, real business names, real confidence scores, spanning every mapped business type plus several deliberately-unmapped categories (`beauty_and_spa`, `church_cathedral`, `landmark_and_historical_building`) and two null-category rows |

Full multi-hundred-MB downloads (MS GlobalML's 18 DR tiles, Open Buildings'
per-country shards) were not pulled in full as part of building this job —
impractical for a sandboxed task. The fetch/stream/parse code paths in
`src/sources/` are written against the real, verified source formats and
were exercised against real files during development (a real MS GlobalML
tile, a real OCHA zip, and — for B-5 — full live DuckDB queries against the
real Overture dataset, not just a downloaded sample); what ships in
`fixtures/` is a small, honest slice of that verification, not the full
dataset.

## Not yet built

The derived `geo.population_grid` and `geo.data_coverage_cell` jobs (depend
on B-4/B-5/B-6 all being loaded for real — see `SODEJA_MVP_BACKLOG.md`'s
Phase 0 refinement #7) and coverage-tier suppression are out of this
package's current scope.

## Related backlog items

B-4 (footprints), B-5 (POI), B-6 (admin geometry + census).
