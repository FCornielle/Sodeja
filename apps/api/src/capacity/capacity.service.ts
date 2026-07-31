import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { combineRange, makeRange, mapRange, numberCompare, parameterToNumericRange, snapshot, type Range } from "@sodeja/calc";
import { withUserSession } from "@sodeja/db";
import { fetchCitationsByIds, fetchParameterValues, findBestParameterValue, resolveParameterValue } from "@sodeja/rules";
import type { CapacityEstimate, CapacityEstimateRequest } from "@sodeja/schemas";
import { requireConfirmedArea } from "../common/area-gate.js";
import {
  fetchBusinessTypeById,
  fetchCapacityParameterTables,
  fetchProjectContext,
  insertCapacityEstimate,
  type CapacityEstimateRow,
} from "./capacity.repository.js";

function toDto(row: CapacityEstimateRow): CapacityEstimate {
  return {
    id: row.id,
    projectId: row.projectId,
    engineVersion: row.engineVersion,
    asOfDate: row.asOfDate,
    inputsSnapshot: row.inputsSnapshot,
    resultsJson: row.resultsJson,
    seatsLow: row.seatsLow,
    seatsBase: row.seatsBase,
    seatsHigh: row.seatsHigh,
    staffLow: row.staffLow,
    staffBase: row.staffBase,
    staffHigh: row.staffHigh,
    dailyCustomersLow: row.dailyCustomersLow,
    dailyCustomersBase: row.dailyCustomersBase,
    dailyCustomersHigh: row.dailyCustomersHigh,
    computedAt: row.computedAt.toISOString(),
  };
}

/**
 * B-12 (Module 6, capacity). "Thin wrapper over @sodeja/calc"
 * (apps/api/README.md): this service resolves the one input @sodeja/calc
 * cannot supply itself (the business type's capacity ratio, via
 * @sodeja/rules) and hands area + ratio to the engine's Range primitives —
 * no hand-rolled division/rounding on a bare number anywhere in this file.
 */
@Injectable()
export class CapacityService {
  async computeCapacityEstimate(
    userId: string,
    projectId: string,
    input: CapacityEstimateRequest,
  ): Promise<CapacityEstimate> {
    return withUserSession(userId, async (client) => {
      const context = await fetchProjectContext(client, projectId);
      if (!context) {
        // RLS already filtered out projects this user cannot see, so "not
        // found" and "not yours" are indistinguishable here by design
        // (matches projects.service.ts's getAssumptions).
        throw new NotFoundException(`project ${projectId} not found`);
      }

      // B-7a's gate, enforced for real: no capacity estimate from an
      // unconfirmed area (risk T1).
      const areaSqm = await requireConfirmedArea(client, projectId);

      if (context.businessTypeId === null) {
        throw new ConflictException("project has no business type set; cannot compute a capacity estimate");
      }
      const businessType = await fetchBusinessTypeById(client, context.businessTypeId);
      if (!businessType) {
        throw new ConflictException(`project's business_type_id ${context.businessTypeId} no longer exists`);
      }

      const asOfDate = new Date().toISOString().slice(0, 10);
      const parameterTables = await fetchCapacityParameterTables(client);

      let resolvedRatio: ReturnType<typeof resolveParameterValue> = null;
      for (const table of parameterTables) {
        const values = await fetchParameterValues(client, table.id);
        const best = findBestParameterValue({ parameterTable: table, parameterValues: values, asOfDate, businessType });
        if (!best) continue;
        const citationsById = await fetchCitationsByIds(client, [best.citationId]);
        resolvedRatio = resolveParameterValue({
          parameterTable: table,
          parameterValues: values,
          citationsById,
          asOfDate,
          businessType,
        });
        break; // by design, at most one capacity ratio table resolves per business type (see B-11 seed migration)
      }

      let seatsRange: Range<number> | null = null;
      let seatsReason: string | null = null;
      if (resolvedRatio) {
        // ratio is m2/seat or m2/occupant. seats = area / ratio is
        // monotonically DECREASING in ratio, so the bound feeding
        // "pessimistic" (fewest seats) must be area / (ratio's HIGH bound),
        // and "optimistic" (most seats) must be area / (ratio's LOW bound) —
        // see @sodeja/calc range.ts's own doc comment on why this inversion
        // is left to the caller rather than the primitive layer.
        const ratioRange = parameterToNumericRange(resolvedRatio);
        const invertedRatio: Range<number> = {
          pessimistic: ratioRange.optimistic,
          base: ratioRange.base,
          optimistic: ratioRange.pessimistic,
        };
        const areaConst = makeRange(areaSqm, areaSqm, areaSqm, numberCompare);
        const rawSeats = combineRange(areaConst, invertedRatio, (area, ratio) => area / ratio, numberCompare);
        seatsRange = mapRange(rawSeats, Math.floor, numberCompare);
      } else {
        seatsReason =
          `no capacity ratio is seeded for business type '${businessType.slug}' ` +
          "(packages/db/migrations/1785520000000_seed-capacity-parameters.sql deliberately left it " +
          "uncovered — no defensible citation was found). The seats/occupant figure is legitimately " +
          "absent, not an error.";
      }

      let staffRange: Range<number> | null = null;
      let staffReason: string | null = null;
      if (input.staffCount !== undefined) {
        staffRange = makeRange(input.staffCount, input.staffCount, input.staffCount, numberCompare);
      } else {
        staffReason =
          "no staffing-density ratio is seeded for any business type (same migration as the seat ratio " +
          "gap) — staff count must be supplied explicitly via the request's staffCount field; none was " +
          "provided for this estimate.";
      }

      const dailyCustomersReason =
        "no rotación/turnover project_assumption exists to derive a daily customer count from a " +
        "defensible basis — left null rather than fabricated (docs/SODEJA_MVP_BACKLOG.md B-12).";

      const inputsSnapshot = {
        projectId,
        businessTypeSlug: businessType.slug,
        areaSqm,
        staffCountInput: input.staffCount ?? null,
        resolvedRatio,
      };
      const result = {
        seats: seatsRange,
        seatsReason,
        staff: staffRange,
        staffReason,
        dailyCustomers: null,
        dailyCustomersReason,
      };

      const snap = snapshot(asOfDate, inputsSnapshot, result);

      const row = await insertCapacityEstimate(client, projectId, {
        engineVersion: snap.engineVersion,
        asOfDate: snap.asOfDate,
        inputsSnapshot: snap.inputsSnapshot,
        resultsJson: snap.result,
        seatsLow: seatsRange?.pessimistic ?? null,
        seatsBase: seatsRange?.base ?? null,
        seatsHigh: seatsRange?.optimistic ?? null,
        staffLow: staffRange?.pessimistic ?? null,
        staffBase: staffRange?.base ?? null,
        staffHigh: staffRange?.optimistic ?? null,
        dailyCustomersLow: null,
        dailyCustomersBase: null,
        dailyCustomersHigh: null,
      });

      return toDto(row);
    });
  }
}
