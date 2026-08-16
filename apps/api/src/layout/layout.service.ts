import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { withUserSession } from "@sodeja/db";
import { fetchCitationsByIds, fetchParameterValues, findBestParameterValue, resolveParameterValue } from "@sodeja/rules";
import type { LayoutParameters, ResolvedParameter } from "@sodeja/schemas";
import { requireConfirmedArea } from "../common/area-gate.js";
import {
  fetchBusinessTypeById,
  fetchLatestCapacityStaff,
  fetchLayoutParameterTables,
  fetchProjectContext,
} from "./layout.repository.js";

const NO_CAPACITY_ESTIMATE_REASON =
  "no capacity estimate exists for this project yet — POST /projects/:id/capacity-estimate to produce " +
  "one. Until then the zone allocation still runs; only the occupant-load plausibility comparison is " +
  "unavailable.";

const NO_STAFF_FIGURE_REASON =
  "the project's latest capacity estimate has no staff figure (staff_base). No staffing-density ratio is " +
  "seeded for any business type (packages/db/migrations/1785520000000_seed-capacity-parameters.sql), so a " +
  "staff count only exists when it was supplied explicitly — recompute the capacity estimate with a " +
  "staffCount to enable the plausibility comparison.";

/**
 * B-13 (Module 4, layout). This service computes nothing: the zone split is
 * user-entered and the allocation is a pure function of numbers the client
 * already holds, so `allocateLayoutZones`/`checkLayoutZonePlausibility` run
 * client-side from `@sodeja/calc` — the same TypeScript artifact on web and
 * on device (apps/mobile/README.md). What the client cannot get for itself is
 * the cited per-zone density, the confirmed area, and the occupant figure to
 * compare against; that, and only that, is what this endpoint resolves.
 *
 * See packages/calc/src/layout.ts's header for why no zone AREA SHARE is
 * proposed here or anywhere: the seeded IBC figures are densities WITHIN a
 * zone, and a proportion BETWEEN zones cannot be derived from them.
 */
@Injectable()
export class LayoutService {
  async getLayoutParameters(userId: string, projectId: string): Promise<LayoutParameters> {
    return withUserSession(userId, async (client) => {
      const context = await fetchProjectContext(client, projectId);
      if (!context) {
        // RLS already filtered out projects this user cannot see, so "not
        // found" and "not yours" are indistinguishable here by design.
        throw new NotFoundException(`project ${projectId} not found`);
      }

      // B-7a's gate (risk T1): the zone areas the client derives from this
      // response are areas of the premises, so an unconfirmed area must not
      // reach them any more than it reaches capacity or costs.
      const areaSqm = await requireConfirmedArea(client, projectId);

      if (context.businessTypeId === null) {
        throw new ConflictException("project has no business type set; cannot resolve layout density parameters");
      }
      const businessType = await fetchBusinessTypeById(client, context.businessTypeId);
      if (!businessType) {
        throw new ConflictException(`project's business_type_id ${context.businessTypeId} no longer exists`);
      }

      const asOfDate = new Date().toISOString().slice(0, 10);
      const parameterTables = await fetchLayoutParameterTables(client);

      const densityParameters: ResolvedParameter[] = [];
      for (const parameterTable of parameterTables) {
        const parameterValues = await fetchParameterValues(client, parameterTable.id);
        const best = findBestParameterValue({ parameterTable, parameterValues, asOfDate, businessType });
        // No layout table resolves for this business type at all when it has
        // no cited zone (salon). Skipping is the honest answer — unlike
        // capacity there is no `break` here, because a business type may
        // legitimately have several covered zones.
        if (!best) continue;
        const citationsById = await fetchCitationsByIds(client, [best.citationId]);
        const resolved = resolveParameterValue({
          parameterTable,
          parameterValues,
          citationsById,
          asOfDate,
          businessType,
        });
        if (resolved) densityParameters.push(resolved);
      }

      const latestCapacity = await fetchLatestCapacityStaff(client, projectId);
      let expectedOccupants: number | null = null;
      let expectedOccupantsReason: string | null = null;
      if (!latestCapacity) {
        expectedOccupantsReason = NO_CAPACITY_ESTIMATE_REASON;
      } else if (latestCapacity.staffBase === null || latestCapacity.staffBase <= 0) {
        // A stored `staff_base` of 0 is a real value (staffCount accepts 0),
        // but it is not an occupant figure anything can be compared against —
        // `checkLayoutZonePlausibility` rejects a non-positive
        // `expectedOccupants` rather than divide by it. Reported as absent.
        expectedOccupantsReason = NO_STAFF_FIGURE_REASON;
      } else {
        expectedOccupants = latestCapacity.staffBase;
      }

      return {
        areaSqm,
        businessTypeSlug: businessType.slug,
        densityParameters,
        expectedOccupants,
        expectedOccupantsReason,
      };
    });
  }
}
