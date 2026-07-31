import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import type { Logger } from "@sodeja/observability";
import { parseCsv } from "../lib/csv.js";
import { readNdjson } from "../lib/ndjson.js";
import { optionalEnv } from "../lib/env.js";
import type { GeoJsonFeature, PolygonGeometry } from "../lib/geojson.js";
import { type FootprintRow, mapMsGlobalMlFeature } from "../transform/footprintRow.js";

/**
 * Microsoft's global building-footprint index. Real, currently-live URL
 * (verified 2026-07 by fetching it directly — see services/ingestion's
 * development notes); MS_GLOBALML_DATASET_LINKS_URL overrides it for a
 * mirror or a future dataset-links.csv location without a code change.
 */
const DEFAULT_DATASET_LINKS_URL =
  "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv";

export interface DatasetLink {
  location: string;
  quadkey: string;
  url: string;
}

/** Pure CSV parsing, unit-testable without a network call. */
export function parseDatasetLinksCsv(content: string): DatasetLink[] {
  const { rows } = parseCsv(content);
  return rows.map((row) => ({
    location: row.Location ?? "",
    quadkey: row.QuadKey ?? "",
    url: row.Url ?? "",
  }));
}

export function filterByRegion(links: readonly DatasetLink[], region: string): DatasetLink[] {
  return links.filter((link) => link.location === region);
}

/** Fetches dataset-links.csv and returns the DR (or configured region) tile list. */
export async function listMsGlobalMlTiles(logger: Logger): Promise<DatasetLink[]> {
  const url = optionalEnv("MS_GLOBALML_DATASET_LINKS_URL", DEFAULT_DATASET_LINKS_URL);
  const region = optionalEnv("MS_GLOBALML_REGION", "DominicanRepublic");

  logger.info({ url }, "fetching MS GlobalML dataset-links.csv");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MS GlobalML dataset-links.csv fetch failed: ${response.status} ${response.statusText}`);
  }
  const content = await response.text();
  const tiles = filterByRegion(parseDatasetLinksCsv(content), region);
  logger.info({ region, tiles: tiles.length }, "resolved MS GlobalML quadkey tiles");
  return tiles;
}

type MsGlobalMlFeature = GeoJsonFeature<{ height: number; confidence: number }, PolygonGeometry>;

/**
 * Streams and parses one quadkey tile (despite the .csv.gz extension, the
 * body is gzip-compressed newline-delimited GeoJSON — see lib/ndjson.ts).
 * Streamed rather than buffered: a single DR tile can be tens of MB
 * decompressed.
 */
export async function* readMsGlobalMlTile(url: string, logger: Logger): AsyncGenerator<FootprintRow> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`MS GlobalML tile fetch failed: ${response.status} ${response.statusText} (${url})`);
  }
  const nodeStream = Readable.fromWeb(response.body as never).pipe(createGunzip());
  let count = 0;
  for await (const feature of readNdjson<MsGlobalMlFeature>(nodeStream)) {
    yield mapMsGlobalMlFeature(feature);
    count++;
  }
  logger.info({ url, features: count }, "parsed MS GlobalML tile");
}

/** Fetches every DR tile in sequence, yielding footprint rows as they parse. */
export async function* fetchMsGlobalMlFootprints(logger: Logger): AsyncGenerator<FootprintRow> {
  const tiles = await listMsGlobalMlTiles(logger);
  for (const tile of tiles) {
    yield* readMsGlobalMlTile(tile.url, logger);
  }
}
