import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { Logger } from "@sodeja/observability";
import { parseCsvLine } from "../lib/csv.js";
import type { FootprintRow } from "../transform/footprintRow.js";
import { mapOpenBuildingsRow } from "../transform/footprintRow.js";

/**
 * Unlike MS GlobalML, Google does not publish one stable, predictable bulk-
 * download manifest URL for Open Buildings V3 per country (its public
 * download page resolves per-country links client-side; several candidate
 * manifest URLs were probed during development of this job and returned
 * 404). Rather than hardcode a guessed/possibly-stale URL, this source reads
 * an explicit, operator-supplied list of gzipped CSV shard URLs — the same
 * "fail clearly, never silently skip" posture services/ingestion/README.md
 * requires for any source needing configuration. Open Buildings is the
 * documented cross-check/gap-fill source (not primary), so
 * ingestBuildingFootprints.ts treats an unset OPEN_BUILDINGS_SOURCE_URLS as
 * "skip this source" rather than a hard failure of the whole B-4 job.
 */
export function isOpenBuildingsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OPEN_BUILDINGS_SOURCE_URLS?.trim());
}

export function parseOpenBuildingsUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.OPEN_BUILDINGS_SOURCE_URLS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

/**
 * Streams and parses one gzipped Open Buildings V3 CSV shard. Google's
 * documented column order is latitude, longitude, area_in_meters,
 * confidence, geometry, full_plus_code — the header row (present in every
 * shard) is used to locate columns by name rather than assuming position, so
 * a future column reorder doesn't silently misparse geometry as confidence.
 */
export async function* readOpenBuildingsShard(url: string, logger: Logger): AsyncGenerator<FootprintRow> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Open Buildings shard fetch failed: ${response.status} ${response.statusText} (${url})`);
  }
  const nodeStream = Readable.fromWeb(response.body as never).pipe(createGunzip());
  const rl = createInterface({ input: nodeStream, crlfDelay: Infinity });

  let header: string[] | null = null;
  let count = 0;
  for await (const line of rl) {
    if (line.trim().length === 0) continue;
    const values = parseCsvLine(line);
    if (!header) {
      header = values;
      continue;
    }
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key] = values[index] ?? "";
    });
    yield mapOpenBuildingsRow(record);
    count++;
  }
  logger.info({ url, features: count }, "parsed Open Buildings shard");
}

export async function* fetchOpenBuildingsFootprints(logger: Logger): AsyncGenerator<FootprintRow> {
  const urls = parseOpenBuildingsUrls();
  for (const url of urls) {
    yield* readOpenBuildingsShard(url, logger);
  }
}
