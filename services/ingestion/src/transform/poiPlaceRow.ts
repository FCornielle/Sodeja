import type { PointGeometry } from "../lib/geojson.js";

/** Matches the source values this job writes (geo.poi_place.source has no CHECK, unlike building_footprint). */
export type PoiSource = "overture";

export interface PoiPlaceRow {
  externalId: string;
  name: string | null;
  /** Mapped to a content.business_type.slug, or null if no reasonable match — see mapOvertureCategory. */
  category: string | null;
  /** The original, un-mapped Overture categories.primary value. Always kept, even when category is null. */
  rawCategory: string | null;
  /** In [0, 1], or null if Overture reports none for this place. Never dropped/filtered here — see README. */
  confidence: number | null;
  geometry: PointGeometry;
  source: PoiSource;
  sourceLicense: string;
  sourceVintage: string; // ISO date
}

export const OVERTURE_SOURCE: PoiSource = "overture";

/**
 * Overture Places licensing is per-contributor, not per-theme or per-release
 * (docs/SODEJA_DATA_SOURCES.md table (a): "mixed per source: most
 * contributors CDLA-Permissive-2.0, Foursquare Apache 2.0, AllThePlaces
 * CC0 — all storable/commercial"). The public S3 Parquet release this job
 * reads does not carry a practical per-row contributor/license column (the
 * closest field, `sources`, lists per-record provenance but not a
 * resolvable license per entry), so there is no accurate way to record a
 * single per-row license the way source_license is used elsewhere in this
 * package. This constant is therefore a single summary string covering the
 * whole mixed-but-all-storable posture, not a claim that every row is under
 * exactly this one license — see the citation above for the underlying
 * per-contributor breakdown if a specific row's license is ever needed.
 */
export const OVERTURE_PLACES_LICENSE =
  "Mixed, per-contributor, all storable/commercial (CDLA-Permissive-2.0 majority, " +
  "Foursquare Apache-2.0, AllThePlaces CC0) — see docs/SODEJA_DATA_SOURCES.md table (a)";

/**
 * Overture releases are named by date (e.g. "2026-07-22.0" — see
 * sources/overturePlaces.ts). source_vintage is a `date` column, so the
 * release's date portion is used directly; the trailing ".0" minor/monthly
 * revision number is not representable in a `date` column and is dropped.
 */
export function overtureReleaseToVintage(release: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(release);
  if (!match) {
    throw new Error(`Cannot derive a source_vintage date from Overture release "${release}"`);
  }
  return match[1]!;
}

/**
 * Overture's documented confidence range is [0, 1], matching
 * geo.poi_place.confidence's `BETWEEN 0 AND 1` CHECK — but this job
 * defensively normalizes out-of-range or missing values to NULL rather than
 * trusting the upstream range promise, the same posture footprintRow.ts
 * takes for MS GlobalML's confidence field.
 */
export function normalizeConfidence(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return value >= 0 && value <= 1 ? value : null;
}

/**
 * Category mapping, Overture `categories.primary` -> content.business_type
 * slug. Deliberately narrow and rule-based (not a large hand-built lookup
 * table) so every mapping decision is auditable in one place:
 *
 *   - restaurante: `restaurant` itself, or anything ending in `_restaurant`
 *     (dominican_restaurant, fast_food_restaurant, pizza_restaurant, ...).
 *     Overture's DR data alone has 15+ such subtypes; a suffix rule covers
 *     all of them without hand-listing each one and silently missing a new
 *     subtype in a future release.
 *   - colmado: `convenience_store` — the closest Overture category to a DR
 *     colmado (small neighborhood corner store).
 *   - minimarket: `grocery_store` — a small/mid-size grocery store, distinct
 *     from a colmado (convenience_store) and from `supermarket` (a larger
 *     format Overture also reports, deliberately left unmapped below: a
 *     minimarket and a full supermarket are not the same business type, and
 *     forcing that mapping would overstate the match).
 *   - ferreteria: `hardware_store` only. `computer_hardware_company` is
 *     explicitly excluded — it is not a DR ferretería (hardware/tools store)
 *     in any sense the business-type parameter sets assume.
 *   - salon: anything ending in `_salon` (beauty_salon, hair_salon,
 *     nail_salon, tanning_salon). Adjacent categories that are single-
 *     service or supply businesses rather than a general salón storefront
 *     (beauty_and_spa, cosmetic_and_beauty_supplies, hair_supply_stores,
 *     laser_hair_removal, hair_stylist, ...) are deliberately left
 *     unmapped — see the module-level comment on not forcing bad matches.
 *
 * Everything else returns null; the caller keeps the original value in
 * rawCategory regardless, per the P0-1 spike's instruction not to silently
 * drop or reshape category information at ingestion time.
 */
export function mapOvertureCategory(primary: string | null | undefined): string | null {
  if (!primary) return null;
  if (primary === "restaurant" || primary.endsWith("_restaurant")) return "restaurante";
  if (primary === "convenience_store") return "colmado";
  if (primary === "grocery_store") return "minimarket";
  if (primary === "hardware_store") return "ferreteria";
  if (primary.endsWith("_salon")) return "salon";
  return null;
}

/** Raw shape this job reads back from the DuckDB query — see sources/overturePlaces.ts. */
export interface OvertureRawPlace {
  id: string;
  name: string | null;
  category: string | null;
  confidence: number | null;
  lon: number;
  lat: number;
}

export function mapOverturePlaceRow(raw: OvertureRawPlace, sourceVintage: string): PoiPlaceRow {
  if (!raw.id) {
    throw new Error("Overture place row is missing id");
  }
  return {
    externalId: raw.id,
    name: raw.name ?? null,
    category: mapOvertureCategory(raw.category),
    rawCategory: raw.category ?? null,
    confidence: normalizeConfidence(raw.confidence),
    geometry: { type: "Point", coordinates: [raw.lon, raw.lat] },
    source: OVERTURE_SOURCE,
    sourceLicense: OVERTURE_PLACES_LICENSE,
    sourceVintage,
  };
}
