import type { PoolClient } from "pg";

/**
 * Shared launch-area grid generation for B-9's two derived jobs
 * (computeDataCoverage.ts -> geo.data_coverage_cell, computePopulationGrid.ts
 * -> geo.population_grid). Both jobs tile the exact same three provinces at
 * the exact same cell size, via the same CTE, so a market-study radius query
 * sees geometrically consistent cells across both tables even though each
 * job owns and fully regenerates its own.
 *
 * Duplicated from apps/api/src/geo/geo.repository.ts's LAUNCH_AREA_PROVINCES
 * rather than imported — apps/api and services/ingestion are separate
 * deployables (this package's own README: "carved out of the monolith from
 * day one", no shared runtime dependency between them), and every other
 * cross-boundary constant in this codebase is duplicated-with-a-comment
 * rather than imported for exactly that reason (see e.g.
 * apps/api/src/costs/costs.repository.ts's doc comment on why each module
 * owns its own minimal reads against shared tables). MUST stay byte-identical
 * to that array — both read the same three `geo.admin_area.level='provincia'`
 * `name` values, per docs/SODEJA_MVP_BACKLOG.md Phase 0 refinement #7's
 * explicit instruction not to hardcode a fourth definition of "the launch
 * area".
 */
export const LAUNCH_AREA_PROVINCES = ["Distrito Nacional", "Santo Domingo", "Santiago"] as const;

/**
 * Grid cell size, in meters. Documented product decision — no cited standard
 * applies to grid resolution, same honesty posture as B-11's capacity
 * ratios: a quarter of specs/ux/flows.md Step 3's default 500m market-study
 * radius, so a default-radius query aggregates over roughly a dozen cells by
 * area (pi * 500^2 / 250^2 ~= 12.6) rather than 1-4 — fine enough that
 * market-study.service.ts's radius sums don't read as blocky/quantized —
 * while keeping the full three-province cell count tractable for a nightly
 * batch job: at ~4,230 km^2 combined (Distrito Nacional ~91.6, Santo Domingo
 * province ~1,302, Santiago province ~2,836) and 0.0625 km^2 per cell, that's
 * roughly 67,700 cells, not a per-request computation.
 */
export const GRID_CELL_SIZE_M = 250;

/**
 * UTM zone 19N (EPSG:32619) — covers the Dominican Republic's full longitude
 * range (roughly -71.7 to -68.3 per the P0-1 spike's bbox measurements,
 * docs/SODEJA_DATA_SOURCES.md), used ONLY to give `ST_SquareGrid` a metric
 * (meters) SRID to tile in. Every stored cell is transformed back to
 * EPSG:4326 before being written — both `geo.data_coverage_cell.cell` and
 * `geo.population_grid.cell` are `geometry(Polygon, 4326)`
 * (specs/db/schema.sql).
 */
export const GRID_METRIC_SRID = 32619;

/**
 * A `WITH`-clause fragment (no leading `WITH`, so callers can prepend/append
 * further CTEs) that tiles the union of the three launch-area provinces into
 * `GRID_CELL_SIZE_M`-meter squares via PostGIS 3.4's `ST_SquareGrid`, and
 * exposes `grid_cells(cell_id, cell)` with `cell` already transformed back to
 * EPSG:4326. Callers MUST bind `$1` to `LAUNCH_AREA_PROVINCES` (a `text[]`
 * parameter) and `$2` to `GRID_CELL_SIZE_M`, and MUST first confirm at least
 * one of the three provinces actually exists in `geo.admin_area` (see
 * `countLaunchAreaProvinces` below) — `ST_SquareGrid` over a NULL bounds
 * geometry (what `ST_Union` returns over zero rows) is not a defined,
 * reliable no-op, so callers avoid calling this CTE at all in that case
 * rather than depending on it degrading gracefully.
 *
 * Cells are kept whenever they INTERSECT the province union, not clipped to
 * it — a cell's square may extend slightly past the true province boundary
 * (e.g. along the coastline or an inter-province edge). This is a
 * deliberate simplification: clipping every cell with `ST_Intersection`
 * would multiply the cost of a ~67,700-cell query for a negligible accuracy
 * gain at 250m resolution, and every generated cell's `is_launch_area` is
 * `true` regardless of exact overlap fraction (B-9's scope: "you're only
 * generating cells inside the three launch provinces").
 */
export function launchAreaGridCte(): string {
  return `
    launch_provinces AS (
      SELECT geom FROM geo.admin_area WHERE level = 'provincia' AND name = ANY($1)
    ),
    launch_union_m AS (
      SELECT ST_Transform(ST_Union(geom), ${GRID_METRIC_SRID}) AS geom_m FROM launch_provinces
    ),
    grid_cells AS (
      SELECT row_number() OVER () AS cell_id, ST_Transform(g.geom, 4326) AS cell
      FROM launch_union_m u,
           LATERAL ST_SquareGrid($2, u.geom_m) AS g(geom, i, j)
      WHERE ST_Intersects(g.geom, u.geom_m)
    )
  `;
}

/**
 * Guard callers of `launchAreaGridCte` must run first: how many of the three
 * `LAUNCH_AREA_PROVINCES` currently have a `geo.admin_area` row? Zero means
 * the admin-area ingestion job (B-6) hasn't run yet in this database — the
 * grid CTE must not be invoked in that case (see its doc comment). A count
 * below 3 is not itself an error (a partially-loaded database can still
 * generate a partial, honest grid for whichever provinces exist), only zero
 * blocks the job entirely.
 */
export async function countLaunchAreaProvinces(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    "SELECT count(*)::int AS n FROM geo.admin_area WHERE level = 'provincia' AND name = ANY($1)",
    [LAUNCH_AREA_PROVINCES],
  );
  return Number(rows[0]?.n ?? 0);
}
