import { Injectable, NotFoundException } from "@nestjs/common";
import { combineRange, makeMoney, makeRange, moneyCompare, multiplyMoney, multiplyMoneyRange, parameterToNumericRange, snapshot, type Range } from "@sodeja/calc";
import { withUserSession } from "@sodeja/db";
import { fetchCitationsByIds, fetchParameterTableBySlug, fetchParameterValues, findBestParameterValue, resolveParameterValue } from "@sodeja/rules";
import type { FitoutEstimate, FitoutEstimateRequest, Money } from "@sodeja/schemas";
import { requireConfirmedArea } from "../common/area-gate.js";
import { fetchProjectContext, insertFitoutEstimate, type FitoutEstimateRow } from "./costs.repository.js";

const ICDV_ESCALATION_SLUG = "icdv_escalacion_anual";

function toDto(row: FitoutEstimateRow): FitoutEstimate {
  return {
    id: row.id,
    projectId: row.projectId,
    engineVersion: row.engineVersion,
    asOfDate: row.asOfDate,
    inputsSnapshot: row.inputsSnapshot,
    resultsJson: row.resultsJson,
    totalLowAmount: row.totalLowAmount,
    totalBaseAmount: row.totalBaseAmount,
    totalHighAmount: row.totalHighAmount,
    currency: row.currency,
    indexBaseDate: row.indexBaseDate,
    computedAt: row.computedAt.toISOString(),
  };
}

/**
 * B-14 (Module 9, fit-out cost). No verified DR commercial fit-out cost
 * basis exists at any confidence level (docs/SODEJA_DATA_SOURCES.md table
 * c) — the base cost per m² is therefore ALWAYS the caller's own input
 * (`FitoutEstimateRequestSchema`, provenance 'usuario'), never a seeded
 * default. The only real, citable DR figure this endpoint contributes is
 * the ICDV escalation factor (packages/db/migrations/
 * 1785540000000_seed-construction-icdv.sql), applied on top via
 * `@sodeja/calc` — never a hand-rolled multiply in this file.
 */
@Injectable()
export class FitoutService {
  async computeFitoutEstimate(
    userId: string,
    projectId: string,
    input: FitoutEstimateRequest,
  ): Promise<FitoutEstimate> {
    return withUserSession(userId, async (client) => {
      const context = await fetchProjectContext(client, projectId);
      if (!context) {
        throw new NotFoundException(`project ${projectId} not found`);
      }

      // B-7a's gate, enforced for real (risk T1).
      const areaSqm = await requireConfirmedArea(client, projectId);

      const asOfDate = new Date().toISOString().slice(0, 10);
      const table = await fetchParameterTableBySlug(client, ICDV_ESCALATION_SLUG);
      if (!table) {
        throw new Error(
          `content.parameter_table '${ICDV_ESCALATION_SLUG}' not found — run migration ` +
            "1785540000000_seed-construction-icdv.sql before computing a fit-out estimate",
        );
      }
      const values = await fetchParameterValues(client, table.id);
      const best = findBestParameterValue({ parameterTable: table, parameterValues: values, asOfDate });
      if (!best) {
        throw new Error(`no in-force value for '${ICDV_ESCALATION_SLUG}' as of ${asOfDate}`);
      }
      const citationsById = await fetchCitationsByIds(client, [best.citationId]);
      const resolvedEscalation = resolveParameterValue({
        parameterTable: table,
        parameterValues: values,
        citationsById,
        asOfDate,
      });
      if (!resolvedEscalation) {
        throw new Error(`resolveParameterValue unexpectedly returned null for '${ICDV_ESCALATION_SLUG}'`);
      }

      const baseCostRange: Range<Money> = makeRange(
        makeMoney(input.baseCostPerSqmLow, input.currency),
        makeMoney(input.baseCostPerSqmBase, input.currency),
        makeMoney(input.baseCostPerSqmHigh, input.currency),
        moneyCompare,
      );

      // total = baseCostPerSqm x area, then apply the ICDV escalation factor
      // on top of that (docs/SODEJA_MVP_BACKLOG.md B-14: "Compute
      // total_low/base/high by applying the ICDV escalation factor to the
      // user-supplied base cost x confirmed area"). Both steps are
      // monotonically increasing, so no bound-inversion is needed (contrast
      // capacity.service.ts's seats-from-ratio division).
      const beforeEscalation = multiplyMoneyRange(baseCostRange, areaSqm);
      const escalationRange = parameterToNumericRange(resolvedEscalation); // percent, e.g. 3.72
      const totalRange = combineRange(
        beforeEscalation,
        escalationRange,
        (money, percent) => multiplyMoney(money, 1 + percent / 100),
        moneyCompare,
      );

      const indexBaseDate = resolvedEscalation.validFrom.slice(0, 10);

      const inputsSnapshot = {
        projectId,
        areaSqm,
        baseCostPerSqm: {
          low: input.baseCostPerSqmLow,
          base: input.baseCostPerSqmBase,
          high: input.baseCostPerSqmHigh,
          currency: input.currency,
        },
        icdvEscalation: resolvedEscalation,
      };
      const result = {
        beforeEscalation,
        total: totalRange,
        disclaimer:
          "Estimación indicativa, no autoritativa (specs/db/schema.sql app.fitout_estimate). No existe " +
          "una base de costo de acondicionamiento comercial verificada para República Dominicana " +
          "(docs/SODEJA_DATA_SOURCES.md). El costo base por m² proviene enteramente del usuario; el " +
          "único ajuste aplicado es el índice ICDV (vivienda, no comercial), usado únicamente como " +
          "factor de escalación, nunca como base de costo.",
      };

      const snap = snapshot(asOfDate, inputsSnapshot, result);

      const row = await insertFitoutEstimate(client, projectId, {
        engineVersion: snap.engineVersion,
        asOfDate: snap.asOfDate,
        inputsSnapshot: snap.inputsSnapshot,
        resultsJson: snap.result,
        totalLowAmount: totalRange.pessimistic.amount,
        totalBaseAmount: totalRange.base.amount,
        totalHighAmount: totalRange.optimistic.amount,
        currency: input.currency,
        indexBaseDate,
      });

      return toDto(row);
    });
  }
}
