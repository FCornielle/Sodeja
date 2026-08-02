import turfArea from "@turf/area";
import turfCentroid from "@turf/centroid";
import { polygon as turfPolygon } from "@turf/helpers";
import turfKinks from "@turf/kinks";

export type LonLat = [number, number];

/**
 * Secondary Flow A's implausible-area band (specs/ux/flows.md: "Implausible
 * area (< 5 m² or > 5,000 m²): warning, not a block"). A stated heuristic
 * threshold, not a cited standard — same honesty discipline as every prior
 * module's own documented sanity ranges (e.g. costs.service.ts's fit-out
 * disclaimer).
 */
export const MIN_PLAUSIBLE_AREA_SQM = 5;
export const MAX_PLAUSIBLE_AREA_SQM = 5000;

/** GeoJSON polygon rings must start and end on the same coordinate. */
function closedRing(points: readonly LonLat[]): LonLat[] {
  if (points.length === 0) return [];
  const [firstLon, firstLat] = points[0]!;
  const [lastLon, lastLat] = points[points.length - 1]!;
  if (firstLon === lastLon && firstLat === lastLat) return [...points];
  return [...points, points[0]!];
}

/**
 * Live area readout for the manual draw path (specs/ux/flows.md Secondary
 * Flow A step 2: "Live area readout in m² updates as the polygon closes").
 * Uses `@turf/area` (real spherical-polygon math, in m²) — never a
 * hand-rolled shoelace formula, per this task's non-negotiable constraint.
 * Returns `null` below 3 points, matching the ">= 3 points" validation gate.
 */
export function polygonAreaSqm(points: readonly LonLat[]): number | null {
  if (points.length < 3) return null;
  const feature = turfPolygon([closedRing(points)]);
  return turfArea(feature);
}

/**
 * Self-intersection check (specs/ux/flows.md Secondary Flow A step 3:
 * "Self-intersecting polygon: vertices highlighted red"). Uses `@turf/kinks`
 * (real topology check) rather than a hand-rolled segment-intersection
 * algorithm, per this task's non-negotiable constraint.
 */
export function polygonSelfIntersects(points: readonly LonLat[]): boolean {
  if (points.length < 3) return false;
  const feature = turfPolygon([closedRing(points)]);
  return turfKinks(feature).features.length > 0;
}

/** Centroid of the drawn polygon, for the `centroidLon`/`centroidLat` the
 * B-7a `PUT /projects/:id/location` request requires. */
export function polygonCentroid(points: readonly LonLat[]): LonLat | null {
  if (points.length < 3) return null;
  const feature = turfPolygon([closedRing(points)]);
  const [lon, lat] = turfCentroid(feature).geometry.coordinates;
  return [lon!, lat!];
}

export function isAreaImplausible(areaSqm: number): boolean {
  return areaSqm < MIN_PLAUSIBLE_AREA_SQM || areaSqm > MAX_PLAUSIBLE_AREA_SQM;
}
