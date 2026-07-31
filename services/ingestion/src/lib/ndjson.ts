import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

/**
 * Microsoft's GlobalML building-footprint export (source of B-4's primary
 * dataset) ships as gzip-compressed newline-delimited JSON — one GeoJSON
 * Feature per line — despite the `.csv.gz` file extension in
 * dataset-links.csv. Confirmed against a real downloaded tile
 * (RegionName=DominicanRepublic) during development of this job.
 *
 * Streams line-by-line rather than buffering the whole decompressed body:
 * a single DR quadkey tile can decompress to tens of MB, and the full
 * 18-tile set is ~179MB compressed (services/ingestion/README.md).
 */
export async function* readNdjson<T>(stream: Readable): AsyncGenerator<T> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    yield JSON.parse(trimmed) as T;
  }
}
