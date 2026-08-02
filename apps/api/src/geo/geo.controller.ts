import { Controller, Get, Query } from "@nestjs/common";
import {
  CoverageQuerySchema,
  FootprintAtPointQuerySchema,
  FootprintBboxQuerySchema,
  type BuildingFootprint,
  type CoverageQuery,
  type CoverageResult,
  type FootprintAtPointQuery,
  type FootprintBboxQuery,
} from "@sodeja/schemas";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { GeoService } from "./geo.service.js";

/**
 * B-7's narrowest slice of Module 2/3: read-only footprint lookup + the
 * launch-area coverage check that unblocks Step 1 of the map UI. No
 * auth/RLS (see geo.service.ts) — no `@UseGuards`, no `x-user-id`, mirroring
 * `CatalogController`.
 */
@Controller("geo")
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  /**
   * Tap-to-select. Returns every footprint containing the tapped point —
   * zero (no candidate, UX spec falls through to Secondary Flow A), one, or
   * several (overlapping datasets, the "multiple candidates" sheet state).
   */
  @Get("footprints/at")
  async footprintsAt(
    @Query(new ZodValidationPipe(FootprintAtPointQuerySchema)) query: FootprintAtPointQuery,
  ): Promise<BuildingFootprint[]> {
    return this.geoService.footprintsAtPoint(query.lon, query.lat);
  }

  /** Viewport footprint layer (rendered at zoom >= 17 per the UX spec). */
  @Get("footprints")
  async footprintsInBbox(
    @Query(new ZodValidationPipe(FootprintBboxQuerySchema)) query: FootprintBboxQuery,
  ): Promise<BuildingFootprint[]> {
    return this.geoService.footprintsInBbox(query.minLon, query.minLat, query.maxLon, query.maxLat);
  }

  /** Drives the UX spec's "Todavia no cubrimos esta zona" banner. */
  @Get("coverage")
  async coverage(
    @Query(new ZodValidationPipe(CoverageQuerySchema)) query: CoverageQuery,
  ): Promise<CoverageResult> {
    return this.geoService.coverageAtPoint(query.lon, query.lat);
  }
}
