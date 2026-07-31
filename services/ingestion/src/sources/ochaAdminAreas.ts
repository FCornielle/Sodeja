import AdmZip from "adm-zip";
import type { Logger } from "@sodeja/observability";
import type { GeoJsonFeatureCollection } from "../lib/geojson.js";
import { optionalEnv } from "../lib/env.js";
import { type AdminAreaRow, type OchaAdmLevel, mapOchaFeature } from "../transform/adminAreaRow.js";

/**
 * Verified 2026-07-25 against HDX's package_show API for dataset
 * "cod-ab-dom": the GeoJSON resource ships as one zip containing per-level
 * files named dom_admin{N}.geojson (plus "_em" edge-matched variants and
 * line/point layers we don't need). This is the documented, stable HDX
 * resource URL for the Dominican Republic COD-AB dataset — see
 * docs/SODEJA_DATA_SOURCES.md's replacement for the dead IDE-RD
 * `RD_SECCIONES` source.
 */
const DEFAULT_ZIP_URL =
  "https://data.humdata.org/dataset/1b26ea94-4d28-4167-9209-4984ab087973/resource/66c7a7c9-5be1-4b1a-8b5a-a559e0c970a8/download/dom_admin_boundaries.geojson.zip";

const ADM_LEVELS: OchaAdmLevel[] = [0, 2, 3, 4];

function entryName(admLevel: OchaAdmLevel): string {
  return `dom_admin${admLevel}.geojson`;
}

/**
 * Extracts the four polygon levels this job needs from a COD-AB GeoJSON zip
 * buffer and maps every feature to an AdminAreaRow. Pure w.r.t. the zip
 * bytes — no network I/O — so it is unit-testable against a small fixture
 * zip without hitting HDX.
 */
export function extractAdminAreaRows(zipBuffer: Buffer, sourceVintage: string): AdminAreaRow[] {
  const zip = new AdmZip(zipBuffer);
  const rows: AdminAreaRow[] = [];

  for (const admLevel of ADM_LEVELS) {
    const entry = zip.getEntry(entryName(admLevel));
    if (!entry) {
      throw new Error(
        `OCHA COD-AB zip is missing ${entryName(admLevel)}; expected dom_admin0/2/3/4.geojson`,
      );
    }
    const collection = JSON.parse(entry.getData().toString("utf8")) as GeoJsonFeatureCollection;
    for (const feature of collection.features) {
      rows.push(mapOchaFeature(feature, admLevel, sourceVintage));
    }
  }
  return rows;
}

/**
 * Downloads the real OCHA COD-AB zip and extracts admin-area rows.
 * OCHA_ADMIN_ZIP_URL lets an operator point at a mirror or a newer resource
 * without a code change (same seam pattern as @sodeja/providers' registry).
 */
export async function fetchOchaAdminAreas(logger: Logger): Promise<AdminAreaRow[]> {
  const url = optionalEnv("OCHA_ADMIN_ZIP_URL", DEFAULT_ZIP_URL);
  logger.info({ url }, "fetching OCHA COD-AB admin boundaries");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OCHA COD-AB fetch failed: ${response.status} ${response.statusText} (${url})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  logger.info({ bytes: buffer.byteLength }, "downloaded OCHA COD-AB zip");

  // The dataset has no per-feature "as of" date beyond `valid_on` on each
  // feature (used preferentially in mapOchaFeature); this is only the
  // fallback if a feature is somehow missing it.
  const fallbackVintage = new Date().toISOString().slice(0, 10);
  return extractAdminAreaRows(buffer, fallbackVintage);
}
