import { Injectable } from "@nestjs/common";
import { withServiceSession } from "@sodeja/db";
import type { BuildingFootprint, CoverageResult } from "@sodeja/schemas";
import { fetchCoverageAtPoint, fetchFootprintsAtPoint, fetchFootprintsInBbox } from "./geo.repository.js";

/**
 * Row cap for `GET /geo/footprints?bbox=`. B-7's Step 1 footprint layer only
 * ever requests a viewport-sized bbox (zoom >= 17, a few hundred meters
 * across); this is a generous sanity ceiling against an unbounded query —
 * not a tuned viewport density estimate. Paired with the ~0.5deg span cap
 * enforced by `FootprintBboxQuerySchema` (@sodeja/schemas geo.ts).
 */
const MAX_BBOX_RESULTS = 2000;

/**
 * B-7: read-only `geo.building_footprint` / `geo.admin_area` lookups. Uses
 * `withServiceSession`, not `withUserSession` — same reasoning as
 * catalog.service.ts: this is shared reference/ingested data with RLS
 * disabled (specs/db/schema.sql section 7), not user-owned data, so there is
 * no `x-user-id` to require. No auth guard on this module's controller for
 * the same reason (apps/api/README.md: geo is reference data, same posture
 * as catalog's `GET /business-types`).
 */
@Injectable()
export class GeoService {
  async footprintsAtPoint(lon: number, lat: number): Promise<BuildingFootprint[]> {
    return withServiceSession((client) => fetchFootprintsAtPoint(client, lon, lat));
  }

  async footprintsInBbox(
    minLon: number,
    minLat: number,
    maxLon: number,
    maxLat: number,
  ): Promise<BuildingFootprint[]> {
    return withServiceSession((client) =>
      fetchFootprintsInBbox(client, minLon, minLat, maxLon, maxLat, MAX_BBOX_RESULTS),
    );
  }

  async coverageAtPoint(lon: number, lat: number): Promise<CoverageResult> {
    return withServiceSession((client) => fetchCoverageAtPoint(client, lon, lat));
  }
}
