import { z } from "zod";

// =========================================================================
// B-7 — geo footprint lookup + launch-area coverage
// =========================================================================

/**
 * Minimal GeoJSON Polygon — only what `geo.building_footprint.geom`
 * (`geometry(Polygon, 4326)`, specs/db/schema.sql) needs to serialize as.
 * Not a general-purpose GeoJSON schema.
 */
export const GeoJsonPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
});
export type GeoJsonPolygon = z.infer<typeof GeoJsonPolygonSchema>;

/** Mirrors `geo.building_footprint.source`'s CHECK constraint (specs/db/schema.sql). */
export const BuildingFootprintSourceSchema = z.enum([
  "open_buildings_v3",
  "ms_globalml",
  "overture",
  "osm",
]);
export type BuildingFootprintSource = z.infer<typeof BuildingFootprintSourceSchema>;

/**
 * `GET /geo/footprints/at` and `GET /geo/footprints` response element.
 * `areaSqm` always travels with `source` + `sourceVintage` — per
 * apps/web/README.md's "never renders a bare number" boundary, a client must
 * never show this area without also showing where it came from.
 */
export const BuildingFootprintSchema = z.object({
  id: z.number().int(),
  geom: GeoJsonPolygonSchema,
  areaSqm: z.number().positive(),
  source: BuildingFootprintSourceSchema,
  sourceLicense: z.string().min(1),
  sourceVintage: z.string(), // ISO date (YYYY-MM-DD)
});
export type BuildingFootprint = z.infer<typeof BuildingFootprintSchema>;

/** `GET /geo/footprints/at?lon=&lat=` and `GET /geo/coverage?lon=&lat=` share this shape. */
export const FootprintAtPointQuerySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
});
export type FootprintAtPointQuery = z.infer<typeof FootprintAtPointQuerySchema>;

export const CoverageQuerySchema = FootprintAtPointQuerySchema;
export type CoverageQuery = FootprintAtPointQuery;

/**
 * Bbox span cap for `GET /geo/footprints?bbox=`: ~0.5 degrees, roughly 50km
 * at DR's latitude — larger than the entire Distrito Nacional + Santo
 * Domingo metro area combined, so no legitimate Step 1 map-viewport request
 * (footprints render at zoom >= 17, a few hundred meters across) is ever
 * rejected. This is a generous sanity ceiling against an unbounded or
 * whole-country query, not a tuned viewport size — see
 * apps/api/src/geo/geo.repository.ts's MAX_BBOX_RESULTS for the matching
 * row-count cap.
 */
const MAX_BBOX_SPAN_DEG = 0.5;

export const FootprintBboxQuerySchema = z
  .object({
    bbox: z.string().transform((value, ctx) => {
      const parts = value.split(",").map((part) => Number(part.trim()));
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bbox must be 4 comma-separated finite numbers: minLon,minLat,maxLon,maxLat",
        });
        return z.NEVER;
      }
      return parts as [number, number, number, number];
    }),
  })
  .transform(({ bbox }) => ({ minLon: bbox[0], minLat: bbox[1], maxLon: bbox[2], maxLat: bbox[3] }))
  .refine((v) => v.minLon >= -180 && v.maxLon <= 180 && v.minLat >= -90 && v.maxLat <= 90, {
    message: "bbox coordinates must be within [-180,180] longitude and [-90,90] latitude",
  })
  .refine((v) => v.minLon < v.maxLon && v.minLat < v.maxLat, {
    message: "bbox min must be less than max on both axes",
  })
  .refine((v) => v.maxLon - v.minLon <= MAX_BBOX_SPAN_DEG && v.maxLat - v.minLat <= MAX_BBOX_SPAN_DEG, {
    message: `bbox span must not exceed ${MAX_BBOX_SPAN_DEG} degrees on either axis`,
  });
export type FootprintBboxQuery = z.infer<typeof FootprintBboxQuerySchema>;

/**
 * `GET /geo/coverage`. Per the Master Plan, launch coverage is exactly
 * Distrito Nacional + Santo Domingo province + Santiago — the same three
 * province names the B-10 seed already uses for `content.jurisdiction`
 * (packages/db/migrations/1785510924741_seed-rules-content.sql), reused here
 * against `geo.admin_area` (level='provincia') rather than a hardcoded bbox.
 * Drives the UX spec's "Todavia no cubrimos esta zona" banner.
 */
export const CoverageResultSchema = z.object({
  covered: z.boolean(),
  adminAreaId: z.number().int().nullable(),
  adminAreaName: z.string().nullable(),
});
export type CoverageResult = z.infer<typeof CoverageResultSchema>;
