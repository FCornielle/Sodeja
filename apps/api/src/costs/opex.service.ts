import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  addMoneyRange,
  combineRange,
  makeMoney,
  makeRange,
  moneyCompare,
  multiplyMoney,
  numberCompare,
  parameterToMoneyRange,
  parameterToNumericRange,
  snapshot,
  type Range,
} from "@sodeja/calc";
import { withUserSession } from "@sodeja/db";
import {
  fetchCitationsByIds,
  fetchJurisdictions,
  fetchParameterTableBySlug,
  fetchParameterValues,
  findBestParameterValue,
  resolveJurisdictionChain,
  resolveParameterValue,
  type Jurisdiction,
  type QueryClient,
  type ResolveParameterValueInput,
} from "@sodeja/rules";
import type { CompanySize, Money, OpexEstimate, OpexEstimateRequest, ResolvedParameter } from "@sodeja/schemas";
import { requireConfirmedArea } from "../common/area-gate.js";
import {
  fetchBusinessTypeById,
  fetchJurisdictionSlugById,
  fetchLatestStaffCount,
  fetchProjectContext,
  insertOpexEstimate,
  type OpexEstimateRow,
} from "./costs.repository.js";

const WAGE_TABLE_SLUG: Record<CompanySize, string> = {
  micro: "salario_minimo_micro",
  pequena: "salario_minimo_pequena",
  mediana: "salario_minimo_mediana",
  grande: "salario_minimo_grande",
};

/**
 * Resolves one B-10 labor parameter by slug. These rows are scoped to
 * jurisdiction 'nacional' (see costs.repository.ts's
 * fetchJurisdictionSlugById doc comment), so a jurisdiction chain that
 * includes it is required — omitting it silently makes every candidate
 * row unmatchable rather than falling back to "applies everywhere". Throws
 * if nothing resolves: these are expected to always be seeded (B-10).
 */
async function resolveLaborParameter(
  client: QueryClient,
  slug: string,
  asOfDate: string,
  jurisdictionChain: readonly Jurisdiction[] | undefined,
): Promise<ResolvedParameter> {
  const table = await fetchParameterTableBySlug(client, slug);
  if (!table) {
    throw new Error(`content.parameter_table '${slug}' not found — expected from the B-10 seed migration`);
  }
  const parameterValues = await fetchParameterValues(client, table.id);
  const best = findBestParameterValue({
    parameterTable: table,
    parameterValues,
    asOfDate,
    ...(jurisdictionChain ? { jurisdictionChain } : {}),
  });
  if (!best) throw new Error(`no in-force value for '${slug}' as of ${asOfDate}`);
  const citationsById = await fetchCitationsByIds(client, [best.citationId]);
  const input: ResolveParameterValueInput = {
    parameterTable: table,
    parameterValues,
    citationsById,
    asOfDate,
    ...(jurisdictionChain ? { jurisdictionChain } : {}),
  };
  const resolved = resolveParameterValue(input);
  if (!resolved) throw new Error(`resolveParameterValue unexpectedly returned null for '${slug}'`);
  return resolved;
}

function toDto(row: OpexEstimateRow): OpexEstimate {
  return {
    id: row.id,
    projectId: row.projectId,
    engineVersion: row.engineVersion,
    asOfDate: row.asOfDate,
    inputsSnapshot: row.inputsSnapshot,
    resultsJson: row.resultsJson,
    monthlyLowAmount: row.monthlyLowAmount,
    monthlyBaseAmount: row.monthlyBaseAmount,
    monthlyHighAmount: row.monthlyHighAmount,
    currency: row.currency,
    computedAt: row.computedAt.toISOString(),
  };
}

/**
 * B-15 (Module 10, opex). Payroll is derived from B-12's
 * `app.capacity_estimate.staff_*` (never re-guessed here); TSS
 * employee-side + INFOTEP are added on top via `@sodeja/rules`-resolved,
 * cited rates only. `companySize` is a required, explicit input — the real
 * dual-criteria legal test (Ley 488-08, headcount AND annual gross sales)
 * cannot be evaluated without a financial projection, which does not exist
 * yet (B-17). TSS employer-side AFP % is never computed (deliberately left
 * unseeded — see resolveLaborParameter callers' comments). Rent/utilities
 * are optional, uncurated line items supplied directly by the caller.
 */
@Injectable()
export class OpexService {
  async computeOpexEstimate(
    userId: string,
    projectId: string,
    input: OpexEstimateRequest,
  ): Promise<OpexEstimate> {
    return withUserSession(userId, async (client) => {
      const context = await fetchProjectContext(client, projectId);
      if (!context) {
        throw new NotFoundException(`project ${projectId} not found`);
      }

      // B-7a's gate applies here too, even though opex math does not
      // consume area directly: docs/SODEJA_MVP_BACKLOG.md groups
      // capacity/fit-out/opex together under the same "never proceed on an
      // unconfirmed area" precondition (risk T1).
      await requireConfirmedArea(client, projectId);

      const asOfDate = new Date().toISOString().slice(0, 10);
      const businessType =
        context.businessTypeId !== null ? await fetchBusinessTypeById(client, context.businessTypeId) : null;

      // The B-10 labor parameters are scoped to jurisdiction 'nacional', not
      // NULL (see costs.repository.ts's fetchJurisdictionSlugById comment),
      // so resolving them needs the project's jurisdiction chain — same
      // pattern as projects.service.ts's getAssumptions.
      let jurisdictionChain: Jurisdiction[] | undefined;
      if (context.jurisdictionId !== null) {
        const slug = await fetchJurisdictionSlugById(client, context.jurisdictionId);
        if (slug) {
          const jurisdictions = await fetchJurisdictions(client);
          jurisdictionChain = resolveJurisdictionChain(jurisdictions, slug);
        }
      }

      const capacityStaff = await fetchLatestStaffCount(client, projectId);
      let staffRange: Range<number> | null = null;
      let staffCountSource: "capacity_estimate" | "request" | null = null;
      if (
        capacityStaff &&
        capacityStaff.staffLow !== null &&
        capacityStaff.staffBase !== null &&
        capacityStaff.staffHigh !== null
      ) {
        staffRange = makeRange(capacityStaff.staffLow, capacityStaff.staffBase, capacityStaff.staffHigh, numberCompare);
        staffCountSource = "capacity_estimate";
      } else if (input.staffCount !== undefined) {
        staffRange = makeRange(input.staffCount, input.staffCount, input.staffCount, numberCompare);
        staffCountSource = "request";
      }

      let payrollUnavailableReason: string | null = null;
      if (!staffRange) {
        payrollUnavailableReason =
          capacityStaff === null
            ? "no capacity estimate exists for this project yet — POST /projects/:id/capacity-estimate " +
              "(with staffCount) first, or supply staffCount directly on this request."
            : "the existing capacity estimate has no staff count (it was computed without staffCount) — " +
              "supply staffCount directly on this request.";
      }

      let payrollTotalRange: Range<Money> | null = null;
      let payrollResult: Record<string, unknown> | null = null;
      if (staffRange) {
        const wageTier = await resolveLaborParameter(client, WAGE_TABLE_SLUG[input.companySize], asOfDate, jurisdictionChain);
        const sfs = await resolveLaborParameter(client, "tss_employee_sfs_rate", asOfDate, jurisdictionChain);
        const afp = await resolveLaborParameter(client, "tss_employee_afp_rate", asOfDate, jurisdictionChain);
        const infotep = await resolveLaborParameter(client, "infotep_employer_rate", asOfDate, jurisdictionChain);

        const wageRange = parameterToMoneyRange(wageTier); // DOP per employee per month
        const grossPayrollRange = combineRange(
          wageRange,
          staffRange,
          (wage, count) => multiplyMoney(wage, count),
          moneyCompare,
        );
        const tssSfsAmount = combineRange(
          grossPayrollRange,
          parameterToNumericRange(sfs),
          (money, percent) => multiplyMoney(money, percent / 100),
          moneyCompare,
        );
        const tssAfpAmount = combineRange(
          grossPayrollRange,
          parameterToNumericRange(afp),
          (money, percent) => multiplyMoney(money, percent / 100),
          moneyCompare,
        );
        const infotepAmount = combineRange(
          grossPayrollRange,
          parameterToNumericRange(infotep),
          (money, percent) => multiplyMoney(money, percent / 100),
          moneyCompare,
        );
        payrollTotalRange = addMoneyRange(
          addMoneyRange(addMoneyRange(grossPayrollRange, tssSfsAmount), tssAfpAmount),
          infotepAmount,
        );

        payrollResult = {
          staffCountSource,
          staffCount: staffRange,
          companySize: input.companySize,
          wageTier,
          grossMonthly: grossPayrollRange,
          tssEmployeeSfs: tssSfsAmount,
          tssEmployeeAfp: tssAfpAmount,
          infotep: infotepAmount,
          total: payrollTotalRange,
        };
      }

      const restaurantWageCaveat =
        businessType?.slug === "restaurante"
          ? "Este cálculo usa la tabla de salario mínimo general (CNS-01-2025). Los negocios " +
            "gastronómicos usan una tabla separada y más alta (Res. CNS-04-2025, +25%), no sembrada " +
            "porque su fuente es una imagen escaneada no extraíble con exactitud " +
            "(docs/SODEJA_DATA_SOURCES.md) — esta cifra de nómina subestima el costo real."
          : null;

      const rentRange: Range<Money> | null =
        input.monthlyRentDop !== undefined
          ? makeRange(
              makeMoney(input.monthlyRentDop, "DOP"),
              makeMoney(input.monthlyRentDop, "DOP"),
              makeMoney(input.monthlyRentDop, "DOP"),
              moneyCompare,
            )
          : null;
      const utilitiesRange: Range<Money> | null =
        input.monthlyUtilitiesDop !== undefined
          ? makeRange(
              makeMoney(input.monthlyUtilitiesDop, "DOP"),
              makeMoney(input.monthlyUtilitiesDop, "DOP"),
              makeMoney(input.monthlyUtilitiesDop, "DOP"),
              moneyCompare,
            )
          : null;

      const lines: Range<Money>[] = [payrollTotalRange, rentRange, utilitiesRange].filter(
        (line): line is Range<Money> => line !== null,
      );
      if (lines.length === 0) {
        throw new ConflictException(
          "cannot compute an operating cost estimate: no payroll (missing staff count) and neither " +
            "rent nor utilities were supplied",
        );
      }
      const totalRange = lines.reduce((acc, line) => addMoneyRange(acc, line));
      const partial = payrollTotalRange === null || rentRange === null || utilitiesRange === null;

      const inputsSnapshot = {
        projectId,
        companySize: input.companySize,
        staffCountInput: input.staffCount ?? null,
        monthlyRentDopInput: input.monthlyRentDop ?? null,
        monthlyUtilitiesDopInput: input.monthlyUtilitiesDop ?? null,
        businessTypeSlug: businessType?.slug ?? null,
      };
      const result = {
        payroll: payrollResult,
        payrollUnavailableReason,
        restaurantWageCaveat,
        employerAfpNote:
          "El aporte patronal AFP de TSS no está modelado — el texto primario de la Ley 87-01 devolvió " +
          "error 403 en ambos intentos de verificación (packages/db/migrations/" +
          "1785510924741_seed-rules-content.sql). Este total de nómina NO incluye esa contribución " +
          "patronal; no debe presentarse como el costo laboral patronal completo.",
        rent: rentRange,
        utilities: utilitiesRange,
        total: totalRange,
        partial,
        disclaimer:
          "Renta y servicios (incluyendo generador/inversor) no tienen índice ni benchmark curado en " +
          "República Dominicana (docs/SODEJA_DATA_SOURCES.md) — solo se incluyen si el usuario los " +
          "suministra directamente. El total es parcial cuando falta cualquiera de los dos.",
      };

      const snap = snapshot(asOfDate, inputsSnapshot, result);

      const row = await insertOpexEstimate(client, projectId, {
        engineVersion: snap.engineVersion,
        asOfDate: snap.asOfDate,
        inputsSnapshot: snap.inputsSnapshot,
        resultsJson: snap.result,
        monthlyLowAmount: totalRange.pessimistic.amount,
        monthlyBaseAmount: totalRange.base.amount,
        monthlyHighAmount: totalRange.optimistic.amount,
        currency: "DOP",
      });

      return toDto(row);
    });
  }
}
