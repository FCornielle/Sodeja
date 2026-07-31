import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  addMoney,
  addMoneyRange,
  combineRange,
  convertMoneyRange,
  makeMoney,
  makeRange,
  moneyCompare,
  multiplyMoney,
  snapshot,
  subtractMoney,
  type FxRate,
  type Range,
} from "@sodeja/calc";
import { withUserSession } from "@sodeja/db";
import type { Currency, FinancialProjection, FinancialProjectionRequest, Money } from "@sodeja/schemas";
import { requireConfirmedArea } from "../common/area-gate.js";
import {
  fetchLatestCapacityEstimateRef,
  fetchLatestFitoutEstimate,
  fetchLatestOpexEstimate,
  fetchProjectFinanceContext,
  insertFinancialProjection,
  type FinancialProjectionRow,
} from "./finance.repository.js";

function toDto(row: FinancialProjectionRow): FinancialProjection {
  return {
    id: row.id,
    projectId: row.projectId,
    engineVersion: row.engineVersion,
    rulePackIds: row.rulePackIds,
    asOfDate: row.asOfDate,
    fxUsdDop: row.fxUsdDop,
    inputsSnapshot: row.inputsSnapshot,
    resultsJson: row.resultsJson,
    breakevenMonthLow: row.breakevenMonthLow,
    breakevenMonthBase: row.breakevenMonthBase,
    breakevenMonthHigh: row.breakevenMonthHigh,
    currency: row.currency,
    computedAt: row.computedAt.toISOString(),
  };
}

function required<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`internal: ${label} unexpectedly null after the prerequisite gate passed`);
  return value;
}

/**
 * Builds the `FxRate` needed to convert `from` -> `to` using the project's
 * pinned `fx_usd_dop` (DOP per 1 USD — specs/api/openapi.yaml's own
 * description of the field). Returns `null` when no conversion is needed
 * (same currency already). Throws a `ConflictException` when a conversion
 * IS needed but no rate is pinned on the project — this engine never
 * assumes DOP/USD parity (packages/calc's "rate-free" property: every FX
 * assumption is an explicit input, never fetched or fabricated).
 */
function buildFxRate(from: Currency, to: Currency, fxUsdDop: number | null): FxRate {
  if (fxUsdDop === null) {
    throw new ConflictException(
      `cannot convert ${from} to ${to} for this projection: the project has no fx_usd_dop rate pinned ` +
        "(app.project.fx_usd_dop) — no update endpoint sets this yet in the current MVP slice",
    );
  }
  if (from === "USD" && to === "DOP") return { from, to, rate: fxUsdDop };
  if (from === "DOP" && to === "USD") return { from, to, rate: 1 / fxUsdDop };
  throw new Error(`unsupported currency pair ${from} -> ${to}`);
}

function toTargetCurrency(range: Range<Money>, target: Currency, fxUsdDop: number | null): Range<Money> {
  if (range.base.currency === target) return range;
  return convertMoneyRange(range, buildFxRate(range.base.currency, target, fxUsdDop));
}

/**
 * `benefit - cost`, with the cost operand's bound labels inverted before
 * combining. `Range<Money>.pessimistic`/`.optimistic` are structural
 * (numerically low/high, per packages/calc/src/range.ts), not "good/bad for
 * the business" — for a quantity being SUBTRACTED (a cost), the bound that
 * makes the net result worst is the cost's numerically HIGHEST amount, not
 * its lowest. Mirrors capacity.service.ts's ratio-inversion reasoning for
 * `seats = area / ratio`. Built as an object literal rather than via
 * `makeRange` because the swapped fields intentionally violate the
 * pessimistic<=optimistic invariant as a value in isolation — only the
 * COMBINED result (validated by `combineRange`) needs to satisfy it.
 */
function subtractCostRange(benefit: Range<Money>, cost: Range<Money>): Range<Money> {
  const invertedCost: Range<Money> = { pessimistic: cost.optimistic, base: cost.base, optimistic: cost.pessimistic };
  return combineRange(benefit, invertedCost, subtractMoney, moneyCompare);
}

/**
 * The month-0 line: `-fitoutTotal`, as a `Range<Money>`. Negating each bound
 * AND swapping which one is assigned to `pessimistic`/`optimistic` are both
 * needed: the highest fit-out cost (worst case) becomes the most-negative
 * cash position, so it must land in `.pessimistic`; the lowest cost (best
 * case) becomes the least-negative position, landing in `.optimistic`.
 * `makeRange` re-validates the result rather than assuming the arithmetic
 * got the direction right.
 */
function negateAsInitialOutlay(cost: Range<Money>): Range<Money> {
  return makeRange(
    multiplyMoney(cost.optimistic, -1),
    multiplyMoney(cost.base, -1),
    multiplyMoney(cost.pessimistic, -1),
    moneyCompare,
  );
}

function buildCumulativeSeries(initialOutlay: Range<Money>, monthlyNet: Range<Money>, horizonMonths: number): Range<Money>[] {
  const series: Range<Money>[] = [initialOutlay];
  let cumulative = initialOutlay;
  for (let m = 1; m <= horizonMonths; m++) {
    cumulative = addMoneyRange(cumulative, monthlyNet);
    series.push(cumulative);
  }
  return series;
}

/**
 * First month (index into `series`; index 0 = the initial outlay, before
 * any operating month) whose cumulative cash under `select` is >= 0.
 * Returns `null` — never the horizon length — when no month qualifies
 * (specs/db/schema.sql: "a NULL here must never render as zero; it means
 * break-even isn't reached in the projection horizon").
 */
function firstMonthAtOrAboveZero(series: readonly Range<Money>[], select: (r: Range<Money>) => Money): number | null {
  for (const [month, cash] of series.entries()) {
    if (select(cash).amount >= 0) return month;
  }
  return null;
}

interface SinglePointResult {
  breakevenMonth: number | null;
  terminalCashAmount: number;
}

/** One-at-a-time sensitivity's inner simulation: single (non-range) Money values, still routed entirely through @sodeja/calc's Money arithmetic — never a bare-number add/subtract on a financial figure. */
function simulateSinglePoint(revenue: Money, opex: Money, fitoutTotal: Money, horizonMonths: number): SinglePointResult {
  const monthlyNet = subtractMoney(revenue, opex);
  let cumulative = multiplyMoney(fitoutTotal, -1);
  let breakevenMonth: number | null = cumulative.amount >= 0 ? 0 : null;
  for (let m = 1; m <= horizonMonths; m++) {
    cumulative = addMoney(cumulative, monthlyNet);
    if (breakevenMonth === null && cumulative.amount >= 0) breakevenMonth = m;
  }
  return { breakevenMonth, terminalCashAmount: cumulative.amount };
}

type SensitivityAssumptionKey = "monthly_revenue" | "monthly_opex" | "fitout_total";

interface SensitivityLine {
  assumptionKey: SensitivityAssumptionKey;
  labelEs: string;
  lowAmount: number;
  highAmount: number;
  breakevenMonthAtLow: number | null;
  breakevenMonthAtHigh: number | null;
  breakevenMonthShift: number | null;
  terminalCashDeltaAmount: number;
}

/**
 * "Lo que más mueve su resultado" (UX spec Step 7, mandatory display): holds
 * two of {revenue, opex, fit-out} at base and varies the third between its
 * own low and high bound, per docs/SODEJA_MVP_BACKLOG.md B-17 ("simple,
 * defensible one-at-a-time sensitivity"). Primary impact metric is the
 * shift in break-even month; when either the low- or high-bound variant
 * never reaches break-even within the horizon, that shift is undefined
 * (`null`) and `terminalCashDeltaAmount` — always computable — is the
 * fallback the caller ranks by instead.
 */
function buildSensitivityLine(
  assumptionKey: SensitivityAssumptionKey,
  labelEs: string,
  lowAmount: number,
  highAmount: number,
  currency: Currency,
  baseRevenue: Money,
  baseOpex: Money,
  baseFitout: Money,
  horizonMonths: number,
  varying: "revenue" | "opex" | "fitout",
): SensitivityLine {
  const pointAt = (amount: number): SinglePointResult => {
    const value = makeMoney(amount, currency);
    const revenue = varying === "revenue" ? value : baseRevenue;
    const opex = varying === "opex" ? value : baseOpex;
    const fitout = varying === "fitout" ? value : baseFitout;
    return simulateSinglePoint(revenue, opex, fitout, horizonMonths);
  };
  const atLow = pointAt(lowAmount);
  const atHigh = pointAt(highAmount);
  const breakevenMonthShift =
    atLow.breakevenMonth !== null && atHigh.breakevenMonth !== null
      ? Math.abs(atHigh.breakevenMonth - atLow.breakevenMonth)
      : null;
  return {
    assumptionKey,
    labelEs,
    lowAmount,
    highAmount,
    breakevenMonthAtLow: atLow.breakevenMonth,
    breakevenMonthAtHigh: atHigh.breakevenMonth,
    breakevenMonthShift,
    terminalCashDeltaAmount: Math.abs(atHigh.terminalCashAmount - atLow.terminalCashAmount),
  };
}

/**
 * B-17 (Module 7, financial projection) — the integration point
 * (apps/api/README.md). Prerequisites (confirmed area, capacity_estimate,
 * fitout_estimate, opex_estimate) are read, never recomputed; the ONE
 * genuinely new input is the caller's own monthly revenue band — no DR
 * micro-business revenue benchmark exists to resolve one via @sodeja/rules
 * (docs/SODEJA_DATA_SOURCES.md). All money/range math routes through
 * @sodeja/calc.
 */
@Injectable()
export class FinanceService {
  async computeFinancialProjection(
    userId: string,
    projectId: string,
    input: FinancialProjectionRequest,
  ): Promise<FinancialProjection> {
    return withUserSession(userId, async (client) => {
      const context = await fetchProjectFinanceContext(client, projectId);
      if (!context) {
        throw new NotFoundException(`project ${projectId} not found`);
      }

      // The prerequisites gate (docs/SODEJA_MVP_BACKLOG.md B-17; UX spec Step
      // 7 "Prerequisites missing... Blocked with a checklist of exactly what
      // is missing"). Every prerequisite is checked before throwing, so the
      // caller gets ONE complete checklist rather than a one-at-a-time
      // trickle of 409s across repeated calls.
      const missing: string[] = [];

      // Reuses requireConfirmedArea (risk T1's gate) but catches its 409
      // rather than letting it abort immediately, so it can be folded into
      // the aggregated checklist below.
      try {
        await requireConfirmedArea(client, projectId);
      } catch (error) {
        if (error instanceof ConflictException) {
          missing.push("missing: confirmed_area — PUT /projects/:id/location first");
        } else {
          throw error;
        }
      }

      const capacityRef = await fetchLatestCapacityEstimateRef(client, projectId);
      if (!capacityRef) missing.push("missing: capacity_estimate — POST /projects/:id/capacity-estimate first");

      const fitoutEstimate = await fetchLatestFitoutEstimate(client, projectId);
      if (!fitoutEstimate) missing.push("missing: fitout_estimate — POST /projects/:id/fitout-estimate first");

      const opexEstimate = await fetchLatestOpexEstimate(client, projectId);
      if (!opexEstimate) missing.push("missing: opex_estimate — POST /projects/:id/opex-estimate first");

      if (missing.length > 0) {
        throw new ConflictException({
          message: `financial projection is blocked: ${missing.length} prerequisite(s) missing`,
          missing,
        });
      }

      const capacity = required(capacityRef, "capacityRef");
      const fitout = required(fitoutEstimate, "fitoutEstimate");
      const opex = required(opexEstimate, "opexEstimate");

      const target = context.reportingCurrency;
      const asOfDate = new Date().toISOString().slice(0, 10);
      const horizonMonths = input.horizonMonths;

      const revenueRange: Range<Money> = makeRange(
        makeMoney(input.monthlyRevenueLow, target),
        makeMoney(input.monthlyRevenueBase, target),
        makeMoney(input.monthlyRevenueHigh, target),
        moneyCompare,
      );

      const fitoutRangeRaw: Range<Money> = makeRange(
        makeMoney(fitout.totalLowAmount, fitout.currency),
        makeMoney(fitout.totalBaseAmount, fitout.currency),
        makeMoney(fitout.totalHighAmount, fitout.currency),
        moneyCompare,
      );
      const opexRangeRaw: Range<Money> = makeRange(
        makeMoney(opex.monthlyLowAmount, opex.currency),
        makeMoney(opex.monthlyBaseAmount, opex.currency),
        makeMoney(opex.monthlyHighAmount, opex.currency),
        moneyCompare,
      );

      // fitout/opex may have been computed in a different currency than the
      // project's reporting_currency (fitout-estimate accepts an explicit
      // currency; opex-estimate is always DOP) — convert both onto the
      // reporting currency before combining anything (never mix currencies
      // inside one Range<Money>, per @sodeja/calc's CurrencyMismatchError).
      const fitoutRange = toTargetCurrency(fitoutRangeRaw, target, context.fxUsdDop);
      const opexRange = toTargetCurrency(opexRangeRaw, target, context.fxUsdDop);

      const monthlyNet = subtractCostRange(revenueRange, opexRange);
      const initialOutlay = negateAsInitialOutlay(fitoutRange);
      const cumulativeSeries = buildCumulativeSeries(initialOutlay, monthlyNet, horizonMonths);

      // Break-even MONTH direction is inverted relative to the cash-AMOUNT
      // direction: a LOWER month number is the BETTER outcome (break-even
      // reached sooner), and that happens along the cash series' OPTIMISTIC
      // trajectory (best case: high revenue, low costs, compounded every
      // month). breakevenMonthLow therefore reads series[m].optimistic, and
      // breakevenMonthHigh reads series[m].pessimistic — the reverse of how
      // "low/high" reads for a Money amount itself. This is exactly the kind
      // of bound-direction mistake risk D1 and this task's brief warn about.
      const breakevenMonthLow = firstMonthAtOrAboveZero(cumulativeSeries, (r) => r.optimistic);
      const breakevenMonthBase = firstMonthAtOrAboveZero(cumulativeSeries, (r) => r.base);
      const breakevenMonthHigh = firstMonthAtOrAboveZero(cumulativeSeries, (r) => r.pessimistic);

      const baseRevenueMoney = revenueRange.base;
      const baseOpexMoney = opexRange.base;
      const baseFitoutMoney = fitoutRange.base;

      const sensitivityLines: SensitivityLine[] = [
        buildSensitivityLine(
          "monthly_revenue",
          "Ingreso mensual",
          revenueRange.pessimistic.amount,
          revenueRange.optimistic.amount,
          target,
          baseRevenueMoney,
          baseOpexMoney,
          baseFitoutMoney,
          horizonMonths,
          "revenue",
        ),
        buildSensitivityLine(
          "monthly_opex",
          "Costo operativo mensual",
          opexRange.pessimistic.amount,
          opexRange.optimistic.amount,
          target,
          baseRevenueMoney,
          baseOpexMoney,
          baseFitoutMoney,
          horizonMonths,
          "opex",
        ),
        buildSensitivityLine(
          "fitout_total",
          "Costo de habilitación (capex)",
          fitoutRange.pessimistic.amount,
          fitoutRange.optimistic.amount,
          target,
          baseRevenueMoney,
          baseOpexMoney,
          baseFitoutMoney,
          horizonMonths,
          "fitout",
        ),
      ];

      // Ranking metric: break-even-month shift when EVERY line produced one
      // (the common case), so all three are compared in the same unit
      // (months). If any line never reaches break-even in one or both of its
      // variants, months stop being a fair cross-line comparison, so the
      // whole ranking falls back to terminal-cash delta (always computable,
      // one consistent currency unit) rather than mixing units across lines.
      const allShiftsKnown = sensitivityLines.every((l) => l.breakevenMonthShift !== null);
      const rankedBy: "breakevenMonthShift" | "terminalCashDelta" = allShiftsKnown
        ? "breakevenMonthShift"
        : "terminalCashDelta";
      const sensitivity = [...sensitivityLines]
        .sort((a, b) =>
          allShiftsKnown
            ? (b.breakevenMonthShift ?? 0) - (a.breakevenMonthShift ?? 0)
            : b.terminalCashDeltaAmount - a.terminalCashDeltaAmount,
        )
        .map((line, index) => ({ ...line, rank: index + 1 }));

      const monthly = cumulativeSeries.map((cumulativeCash, month) => ({
        month,
        revenue: month === 0 ? null : revenueRange,
        opex: month === 0 ? null : opexRange,
        netCash: month === 0 ? initialOutlay : monthlyNet,
        cumulativeCash,
      }));

      const inputsSnapshot = {
        projectId,
        reportingCurrency: target,
        fxUsdDop: context.fxUsdDop,
        horizonMonths,
        monthlyRevenueInput: {
          low: input.monthlyRevenueLow,
          base: input.monthlyRevenueBase,
          high: input.monthlyRevenueHigh,
          currency: target,
          provenance: "usuario",
        },
        capacityEstimateId: capacity.id,
        fitoutEstimate: {
          id: fitout.id,
          totalLowAmount: fitout.totalLowAmount,
          totalBaseAmount: fitout.totalBaseAmount,
          totalHighAmount: fitout.totalHighAmount,
          currency: fitout.currency,
        },
        opexEstimate: {
          id: opex.id,
          monthlyLowAmount: opex.monthlyLowAmount,
          monthlyBaseAmount: opex.monthlyBaseAmount,
          monthlyHighAmount: opex.monthlyHighAmount,
          currency: opex.currency,
        },
      };

      const result = {
        horizonMonths,
        monthly,
        breakeven: { low: breakevenMonthLow, base: breakevenMonthBase, high: breakevenMonthHigh },
        sensitivity,
        rankedBy,
        disclaimer:
          "Esta proyección combina un supuesto suministrado por el usuario (ingreso mensual) con " +
          "estimaciones del sistema (capacidad, habilitación, costos operativos), todas expresadas " +
          "como rangos, nunca como una cifra única. No es un plan de negocio auditado ni sustituye " +
          "asesoría financiera profesional — no debe usarse como única base para una decisión de " +
          "inversión o financiamiento (docs/SODEJA_RISKS.md riesgo L1).",
      };

      const snap = snapshot(asOfDate, inputsSnapshot, result);

      const row = await insertFinancialProjection(client, projectId, {
        engineVersion: snap.engineVersion,
        asOfDate: snap.asOfDate,
        fxUsdDop: context.fxUsdDop,
        inputsSnapshot: snap.inputsSnapshot,
        resultsJson: snap.result,
        breakevenMonthLow,
        breakevenMonthBase,
        breakevenMonthHigh,
        currency: target,
      });

      return toDto(row);
    });
  }
}
