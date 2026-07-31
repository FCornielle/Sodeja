import type { QueryClient } from "@sodeja/rules";
import type { Currency } from "@sodeja/schemas";

/**
 * Minimal project-aggregate read this module needs. Deliberately NOT
 * imported from `../projects/projects.repository.js` or `../costs/costs.
 * repository.js` — each module owns its own small queries against shared
 * tables (apps/api/README.md "Architectural rules"; see capacity.repository.ts's
 * doc comment for the same reasoning).
 */
export interface ProjectFinanceContext {
  reportingCurrency: Currency;
  /** DOP per 1 USD, pinned per project (specs/db/schema.sql app.project). Null until an update endpoint sets it — none exists yet in this MVP slice. */
  fxUsdDop: number | null;
}

export async function fetchProjectFinanceContext(
  client: QueryClient,
  projectId: string,
): Promise<ProjectFinanceContext | null> {
  const { rows } = await client.query<{ reporting_currency: Currency; fx_usd_dop: string | null }>(
    "SELECT reporting_currency, fx_usd_dop FROM app.project WHERE id = $1",
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    reportingCurrency: row.reporting_currency,
    fxUsdDop: row.fx_usd_dop === null ? null : Number(row.fx_usd_dop),
  };
}

/**
 * Existence-only reference to the project's latest `app.capacity_estimate`
 * row (one of B-17's four hard prerequisites). Its own figures are never
 * re-read here — capacity feeds `opex_estimate` (staff count), not the
 * projection directly — but its `id` is recorded in `inputs_snapshot` so a
 * stored projection is fully traceable back to the estimate chain that fed
 * it.
 */
export interface LatestCapacityEstimateRef {
  id: number;
}

export async function fetchLatestCapacityEstimateRef(
  client: QueryClient,
  projectId: string,
): Promise<LatestCapacityEstimateRef | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM app.capacity_estimate WHERE project_id = $1 ORDER BY computed_at DESC LIMIT 1`,
    [projectId],
  );
  const row = rows[0];
  return row ? { id: Number(row.id) } : null;
}

export interface LatestFitoutEstimateRef {
  id: number;
  totalLowAmount: number;
  totalBaseAmount: number;
  totalHighAmount: number;
  currency: Currency;
}

export async function fetchLatestFitoutEstimate(
  client: QueryClient,
  projectId: string,
): Promise<LatestFitoutEstimateRef | null> {
  const { rows } = await client.query<{
    id: string;
    total_low_amount: string;
    total_base_amount: string;
    total_high_amount: string;
    currency: Currency;
  }>(
    `SELECT id, total_low_amount, total_base_amount, total_high_amount, currency
       FROM app.fitout_estimate WHERE project_id = $1 ORDER BY computed_at DESC LIMIT 1`,
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    totalLowAmount: Number(row.total_low_amount),
    totalBaseAmount: Number(row.total_base_amount),
    totalHighAmount: Number(row.total_high_amount),
    currency: row.currency,
  };
}

export interface LatestOpexEstimateRef {
  id: number;
  monthlyLowAmount: number;
  monthlyBaseAmount: number;
  monthlyHighAmount: number;
  currency: Currency;
}

export async function fetchLatestOpexEstimate(
  client: QueryClient,
  projectId: string,
): Promise<LatestOpexEstimateRef | null> {
  const { rows } = await client.query<{
    id: string;
    monthly_low_amount: string;
    monthly_base_amount: string;
    monthly_high_amount: string;
    currency: Currency;
  }>(
    `SELECT id, monthly_low_amount, monthly_base_amount, monthly_high_amount, currency
       FROM app.opex_estimate WHERE project_id = $1 ORDER BY computed_at DESC LIMIT 1`,
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    monthlyLowAmount: Number(row.monthly_low_amount),
    monthlyBaseAmount: Number(row.monthly_base_amount),
    monthlyHighAmount: Number(row.monthly_high_amount),
    currency: row.currency,
  };
}

export interface FinancialProjectionRow {
  id: string;
  projectId: string;
  engineVersion: string;
  rulePackIds: number[];
  asOfDate: string;
  fxUsdDop: number | null;
  inputsSnapshot: Record<string, unknown>;
  resultsJson: Record<string, unknown>;
  breakevenMonthLow: number | null;
  breakevenMonthBase: number | null;
  breakevenMonthHigh: number | null;
  currency: Currency;
  computedAt: Date;
}

export interface InsertFinancialProjectionInput {
  engineVersion: string;
  asOfDate: string;
  fxUsdDop: number | null;
  inputsSnapshot: unknown;
  resultsJson: unknown;
  breakevenMonthLow: number | null;
  breakevenMonthBase: number | null;
  breakevenMonthHigh: number | null;
  currency: Currency;
}

function toIsoDate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

/**
 * `rule_pack_ids` is always the literal `'{}'` — no permit/tax
 * `content.rule_pack` rows exist yet (B-18/B-11 seeded only parameter
 * values), so there is nothing real to bind here. Not a parameter, to make
 * that "nothing to fabricate" posture visible in the query itself rather
 * than passed as an always-empty array from the caller.
 */
export async function insertFinancialProjection(
  client: QueryClient,
  projectId: string,
  input: InsertFinancialProjectionInput,
): Promise<FinancialProjectionRow> {
  const { rows } = await client.query<{
    id: string;
    project_id: string;
    engine_version: string;
    rule_pack_ids: string[] | null;
    as_of_date: unknown;
    fx_usd_dop: string | null;
    inputs_snapshot: Record<string, unknown>;
    results_json: Record<string, unknown>;
    breakeven_month_low: number | null;
    breakeven_month_base: number | null;
    breakeven_month_high: number | null;
    currency: Currency;
    computed_at: Date;
  }>(
    `INSERT INTO app.financial_projection
       (project_id, engine_version, rule_pack_ids, as_of_date, fx_usd_dop, inputs_snapshot, results_json,
        breakeven_month_low, breakeven_month_base, breakeven_month_high, currency)
     VALUES ($1, $2, '{}', $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, project_id, engine_version, rule_pack_ids, as_of_date, fx_usd_dop, inputs_snapshot, results_json,
               breakeven_month_low, breakeven_month_base, breakeven_month_high, currency, computed_at`,
    [
      projectId,
      input.engineVersion,
      input.asOfDate,
      input.fxUsdDop,
      JSON.stringify(input.inputsSnapshot),
      JSON.stringify(input.resultsJson),
      input.breakevenMonthLow,
      input.breakevenMonthBase,
      input.breakevenMonthHigh,
      input.currency,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("app.financial_projection insert returned no row");
  return {
    id: row.id,
    projectId: row.project_id,
    engineVersion: row.engine_version,
    rulePackIds: (row.rule_pack_ids ?? []).map(Number),
    asOfDate: toIsoDate(row.as_of_date),
    fxUsdDop: row.fx_usd_dop === null ? null : Number(row.fx_usd_dop),
    inputsSnapshot: row.inputs_snapshot,
    resultsJson: row.results_json,
    breakevenMonthLow: row.breakeven_month_low,
    breakevenMonthBase: row.breakeven_month_base,
    breakevenMonthHigh: row.breakeven_month_high,
    currency: row.currency,
    computedAt: row.computed_at,
  };
}
