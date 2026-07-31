import type { Logger } from "@sodeja/observability";
import { optionalEnv } from "../lib/env.js";
import {
  type OvertureRawPlace,
  type PoiPlaceRow,
  mapOverturePlaceRow,
  overtureReleaseToVintage,
} from "../transform/poiPlaceRow.js";

export interface Bbox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/**
 * Overture release tag. "2026-07-22.0" is the release the P0-1 spike
 * measured against (docs/SODEJA_DATA_SOURCES.md); OVERTURE_RELEASE
 * overrides it for a future release without a code change. Releases are
 * immutable once published, so pinning a default here (rather than
 * resolving "latest" dynamically) keeps a given deploy's ingested data
 * reproducible.
 */
const DEFAULT_RELEASE = "2026-07-22.0";

/**
 * MVP geography per docs/SODEJA_MASTER_PLAN.md §2: Distrito Nacional +
 * Santo Domingo province + Santiago, everywhere else explicitly "not
 * covered". geo.admin_area is not guaranteed to hold real, full-DR OCHA
 * polygons at the time this job runs (B-6's admin-area job requires a live
 * fetch too, and only a small single-province fixture chain ships in this
 * package's tests) — so this job scopes by bounding box, the same
 * methodology the P0-1 spike used and live-verified, rather than by
 * ST_Contains against geo.admin_area. Documented choice, not an oversight:
 * see services/ingestion/README.md's B-5 section.
 *
 * These two bboxes are wider than the spike's tight "urban core" boxes
 * (which were deliberately narrow, for a quick coverage measurement) —
 * widened here to reasonably cover the full target administrative areas
 * (all of Distrito Nacional + the Santo Domingo province ring around it;
 * the Santiago municipio, not just its downtown core), and re-verified live
 * against the real S3 dataset during B-5 development: 42,906 places
 * (Distrito Nacional + Santo Domingo province bbox) and 8,421 places
 * (Santiago bbox), with DO-address contamination from neighboring
 * countries under 0.1% inside either box (checked via the same
 * addresses[1].country cross-tab method the spike used). Overridable via
 * OVERTURE_SD_BBOX / OVERTURE_SANTIAGO_BBOX ("minLon,maxLon,minLat,maxLat")
 * without a code change.
 */
export const DEFAULT_SD_BBOX: Bbox = { minLon: -70.2, maxLon: -69.52, minLat: 18.3, maxLat: 18.7 };
export const DEFAULT_SANTIAGO_BBOX: Bbox = { minLon: -70.8, maxLon: -70.55, minLat: 19.35, maxLat: 19.55 };

export function parseBbox(raw: string): Bbox {
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid bbox "${raw}"; expected "minLon,maxLon,minLat,maxLat"`);
  }
  const [minLon, maxLon, minLat, maxLat] = parts as [number, number, number, number];
  return { minLon, maxLon, minLat, maxLat };
}

function resolveBbox(envVar: string, fallback: Bbox): Bbox {
  const raw = process.env[envVar];
  return raw && raw.trim().length > 0 ? parseBbox(raw) : fallback;
}

/**
 * Builds the SQL + positional params for one bbox-scoped extraction. Pure
 * and unit-testable without a live DuckDB/network call — see
 * overturePlaces.test.ts. `minConfidence`, when set, is applied here as a
 * documented, overridable floor (OVERTURE_MIN_CONFIDENCE) — NOT a
 * hardcoded silent drop. Left unset by default: the P0-1 spike explicitly
 * recommended keeping confidence queryable rather than filtering it away at
 * ingestion time, and 42,906 + 8,421 rows is not large enough to need a
 * row-count-driven floor.
 */
export function buildOverturePlacesQuery(
  release: string,
  bbox: Bbox,
  minConfidence?: number,
): { sql: string; params: number[] } {
  const base = `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*`;
  const params = [bbox.minLon, bbox.maxLon, bbox.minLat, bbox.maxLat];
  let sql = `
    SELECT
      id AS id,
      names.primary AS name,
      categories.primary AS category,
      confidence AS confidence,
      ST_X(geometry) AS lon,
      ST_Y(geometry) AS lat
    FROM read_parquet('${base}', filename=true, hive_partitioning=1)
    WHERE bbox.xmin BETWEEN ? AND ?
      AND bbox.ymin BETWEEN ? AND ?
  `;
  if (minConfidence !== undefined) {
    sql += ` AND confidence >= ?`;
    params.push(minConfidence);
  }
  return { sql: sql.trim(), params };
}

// `duckdb`'s own package types (services/ingestion/node_modules/duckdb/lib/duckdb.d.ts)
// declare Connection#run/#stream with permissive `any` signatures (a
// callback-style API predating precise TS support), so callers still need a
// small typed wrapper. No @types/duckdb exists on npm — this package ships
// its own declarations, so no extra devDependency is needed for typechecking.
type DuckDbConnection = import("duckdb").Connection;

function run(con: DuckDbConnection, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    con.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Opens an in-memory DuckDB connection configured exactly per the P0-1
 * spike's verified methodology: `spatial` for the geometry column,
 * `httpfs` for S3, region set to where the Overture bucket lives. No
 * credentials are configured — DuckDB's httpfs defaults to an anonymous
 * request when none are set, which is what makes this a no-sign-request
 * read of Overture's public bucket (re-verified live during B-5
 * development: works with zero AWS credentials in the environment).
 */
async function openConnection(): Promise<DuckDbConnection> {
  // Imported lazily (not at module top-level) so that packages which import
  // from this file's sibling modules (e.g. transform/poiPlaceRow.ts, or
  // this package's index.ts re-exports) do not pay for loading duckdb's
  // native binding unless a POI ingestion actually runs.
  const duckdb = await import("duckdb");
  const db = new duckdb.Database(":memory:");
  const con = db.connect();
  await run(con, "INSTALL spatial; LOAD spatial;");
  await run(con, "INSTALL httpfs; LOAD httpfs;");
  await run(con, "SET s3_region='us-west-2';");
  return con;
}

function toRawPlace(row: Record<string, unknown>): OvertureRawPlace {
  return {
    id: String(row.id),
    name: row.name === null || row.name === undefined ? null : String(row.name),
    category: row.category === null || row.category === undefined ? null : String(row.category),
    confidence:
      row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    lon: Number(row.lon),
    lat: Number(row.lat),
  };
}

/**
 * Streams one bbox's worth of Overture Places rows, mapped to PoiPlaceRow.
 * Uses DuckDB's Connection#stream (an async-iterable query result) rather
 * than #all so rows are yielded as they arrive instead of buffering the
 * full bbox result set (tens of thousands of rows) in memory at once —
 * same "stream, don't buffer" posture as msGlobalMl.ts's tile reader.
 */
export async function* queryOverturePlaces(
  bbox: Bbox,
  logger: Logger,
  options: { release?: string; minConfidence?: number } = {},
): AsyncGenerator<PoiPlaceRow> {
  const release = options.release ?? optionalEnv("OVERTURE_RELEASE", DEFAULT_RELEASE);
  const sourceVintage = overtureReleaseToVintage(release);
  const { sql, params } = buildOverturePlacesQuery(release, bbox, options.minConfidence);

  logger.info({ bbox, release, minConfidence: options.minConfidence }, "querying Overture Places via DuckDB");
  const con = await openConnection();
  let count = 0;
  for await (const row of con.stream(sql, ...params)) {
    yield mapOverturePlaceRow(toRawPlace(row), sourceVintage);
    count++;
  }
  logger.info({ bbox, release, rows: count }, "finished streaming Overture Places bbox");
}

/**
 * Fetches Overture Places for both MVP metro areas (Distrito Nacional +
 * Santo Domingo province, and Santiago) in sequence. An optional
 * OVERTURE_MIN_CONFIDENCE env var (parsed as a float in [0,1]) is applied
 * as the documented, overridable ingest-time floor described above — unset
 * by default.
 */
export async function* fetchOverturePlaces(logger: Logger): AsyncGenerator<PoiPlaceRow> {
  const sdBbox = resolveBbox("OVERTURE_SD_BBOX", DEFAULT_SD_BBOX);
  const santiagoBbox = resolveBbox("OVERTURE_SANTIAGO_BBOX", DEFAULT_SANTIAGO_BBOX);
  const minConfidenceRaw = process.env.OVERTURE_MIN_CONFIDENCE;
  const minConfidence = minConfidenceRaw && minConfidenceRaw.trim().length > 0
    ? Number(minConfidenceRaw)
    : undefined;
  if (minConfidence !== undefined && (Number.isNaN(minConfidence) || minConfidence < 0 || minConfidence > 1)) {
    throw new Error(`OVERTURE_MIN_CONFIDENCE must be a number in [0, 1], got "${minConfidenceRaw}"`);
  }

  yield* queryOverturePlaces(sdBbox, logger, { minConfidence });
  yield* queryOverturePlaces(santiagoBbox, logger, { minConfidence });
}
