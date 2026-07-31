# `services/ingestion` — Scheduled Data Ingestion Jobs

**Status: B-6 (admin geometry + census) is implemented.** B-4 (building
footprints) and B-5 (POI) are not yet — see "Not yet built" below.

Carved out of the monolith **from day one**: these jobs are long-running,
memory-hungry, and must be able to fail without taking the API down. An
ingestion job that OOMs should not return 503 to a user drawing a polygon.

## What's implemented

| Job | Source(s) | Target table | Entry point |
|---|---|---|---|
| Admin geometry | OCHA COD-AB on HDX (`dom_admin_boundaries.geojson.zip`) | `geo.admin_area` | `pnpm ingest:admin-areas` |
| Census population | ONE Censo 2022 (manual REDATAM extract — see below) | `geo.census_population` | `pnpm ingest:census` |

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
single `BEGIN`/`COMMIT` (delete-by-source, insert-from-staging, or an atomic
upsert transaction for census). If fetching/parsing fails partway through, the
temp table is simply dropped and `geo.*` was never opened for writing.
Re-running a job with the same input produces the same end state, not
duplicates.

**Licence tier is enforced at write time.** These jobs write only to the
`geo` schema. Per-record `source`, `source_license`/`source_vintage` are set
on every row and are `NOT NULL` in the schema — an unattributed row is a
compliance defect, not untidy metadata (risks L4, L6).

**Vintage is surfaced, not hidden.** `source_vintage` always reflects the
upstream dataset's own vintage (OCHA's `valid_on`, ONE's census year) — never
the date the job happened to run.

## What must never be ingested

Google Places content beyond `place_id` and coordinates, and any content
derived from commercial satellite tiles. Neither applies to this package's
current scope (admin geometry, census); the `ephemeral` schema exists
precisely so that a future POI job (B-5) has somewhere to put short-lived,
non-redistributable provider content without touching `geo.*`.

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

## Fixtures — what's real vs. synthetic

| Fixture | Status |
|---|---|
| `fixtures/ocha-admin{0,2,3,4}-sample.geojson`, `ocha-admin-boundaries-sample.zip` | Real properties/pcodes/names/hierarchy from an actually-downloaded OCHA COD-AB zip (one real parent→child chain: país → Provincia Duarte → Municipio Arenoso → its 3 secciones); geometries for `pais`/`provincia`/`municipio` are simplified to each real polygon's bounding box to keep fixture size small — `seccion` geometries are likewise bbox-simplified for the same reason |
| `fixtures/census-extract-FIXTURE.csv` | **Mixed.** National totals are real; sub-national split is arbitrary (see above) |

The full OCHA COD-AB zip (~178MB across 13 layers) was downloaded during
development to verify the real resource format and produce this fixture;
what ships here is a small, honest trim of it (four ADM levels, one real
parent→child chain), not the full dataset.

## Not yet built

Building footprints (B-4), POI ingestion (B-5, pending the P0-1 coverage
spike), the derived `geo.population_grid` and `geo.data_coverage_cell` jobs,
and coverage-tier suppression are all out of this package's current scope.

## Related backlog items

B-6 (admin geometry + census). B-4 (footprints) and B-5 (POI) are not
implemented here.
