import type { QueryClient } from "@sodeja/rules";
import type {
  CapacityEstimate,
  Currency,
  FinancialProjection,
  FitoutEstimate,
  MarketStudy,
  OpexEstimate,
  Provenance,
  ProjectAssumption,
  ReportStatus,
  ReportTier,
} from "@sodeja/schemas";

/**
 * The minimal project-aggregate reads this module needs, own queries
 * against shared tables (apps/api/README.md "Architectural rules") — same
 * "each module owns its own small reads" posture `finance.repository.ts`
 * and `permits.repository.ts` document. What is different from every prior
 * consumer: this module reads the LATEST row of every upstream estimate
 * table at once, for the render job to assemble into one document.
 */
export interface ReportProjectContext {
  name: string;
  reportingCurrency: Currency;
  businessTypeNameEs: string | null;
  jurisdictionName: string | null;
}

export async function fetchReportProjectContext(client: QueryClient, projectId: string): Promise<ReportProjectContext | null> {
  const { rows } = await client.query<{
    name: string;
    reporting_currency: Currency;
    business_type_name_es: string | null;
    jurisdiction_name: string | null;
  }>(
    `SELECT p.name, p.reporting_currency,
            bt.name_es AS business_type_name_es,
            j.name AS jurisdiction_name
       FROM app.project p
       LEFT JOIN content.business_type bt ON bt.id = p.business_type_id
       LEFT JOIN content.jurisdiction j ON j.id = p.jurisdiction_id
      WHERE p.id = $1`,
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    name: row.name,
    reportingCurrency: row.reporting_currency,
    businessTypeNameEs: row.business_type_name_es,
    jurisdictionName: row.jurisdiction_name,
  };
}

export interface ReportLocationRow {
  areaSqm: number;
  areaSource: string;
  areaConfirmedAt: string;
}

export async function fetchConfirmedLocation(client: QueryClient, projectId: string): Promise<ReportLocationRow | null> {
  const { rows } = await client.query<{ area_sqm: string; area_source: string; area_confirmed_at: Date }>(
    `SELECT area_sqm, area_source, area_confirmed_at
       FROM app.project_location
      WHERE project_id = $1 AND area_confirmed_at IS NOT NULL AND area_sqm IS NOT NULL`,
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;
  return { areaSqm: Number(row.area_sqm), areaSource: row.area_source, areaConfirmedAt: row.area_confirmed_at.toISOString() };
}

export async function fetchLatestMarketStudy(client: QueryClient, projectId: string): Promise<MarketStudy | null> {
  const { rows } = await client.query<{
    project_id: string;
    engine_version: string;
    radius_m: number;
    population_est: number;
    competitor_count: number;
    competitors_user_added: number;
    demand_index_low: string | null;
    demand_index_base: string | null;
    demand_index_high: string | null;
    confidence: MarketStudy["confidence"];
    census_year: number;
    poi_vintage: Date | null;
    computed_at: Date;
  }>(`SELECT * FROM app.market_study WHERE project_id = $1`, [projectId]);
  const row = rows[0];
  if (!row) return null;
  return {
    projectId: row.project_id,
    engineVersion: row.engine_version,
    radiusM: row.radius_m,
    populationEst: row.population_est,
    competitorCount: row.competitor_count,
    competitorsUserAdded: row.competitors_user_added,
    demandIndexLow: row.demand_index_low === null ? null : Number(row.demand_index_low),
    demandIndexBase: row.demand_index_base === null ? null : Number(row.demand_index_base),
    demandIndexHigh: row.demand_index_high === null ? null : Number(row.demand_index_high),
    confidence: row.confidence,
    censusYear: row.census_year,
    poiVintage: row.poi_vintage ? row.poi_vintage.toISOString().slice(0, 10) : null,
    computedAt: row.computed_at.toISOString(),
  };
}

export async function fetchLatestCapacityEstimate(client: QueryClient, projectId: string): Promise<CapacityEstimate | null> {
  const { rows } = await client.query<{
    id: string;
    project_id: string;
    engine_version: string;
    as_of_date: Date;
    inputs_snapshot: Record<string, unknown>;
    results_json: Record<string, unknown>;
    seats_low: number | null;
    seats_base: number | null;
    seats_high: number | null;
    staff_low: number | null;
    staff_base: number | null;
    staff_high: number | null;
    daily_customers_low: number | null;
    daily_customers_base: number | null;
    daily_customers_high: number | null;
    computed_at: Date;
  }>(`SELECT * FROM app.capacity_estimate WHERE project_id = $1 ORDER BY computed_at DESC LIMIT 1`, [projectId]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    projectId: row.project_id,
    engineVersion: row.engine_version,
    asOfDate: row.as_of_date.toISOString().slice(0, 10),
    inputsSnapshot: row.inputs_snapshot,
    resultsJson: row.results_json,
    seatsLow: row.seats_low,
    seatsBase: row.seats_base,
    seatsHigh: row.seats_high,
    staffLow: row.staff_low,
    staffBase: row.staff_base,
    staffHigh: row.staff_high,
    dailyCustomersLow: row.daily_customers_low,
    dailyCustomersBase: row.daily_customers_base,
    dailyCustomersHigh: row.daily_customers_high,
    computedAt: row.computed_at.toISOString(),
  };
}

export async function fetchLatestFitoutEstimate(client: QueryClient, projectId: string): Promise<FitoutEstimate | null> {
  const { rows } = await client.query<{
    id: string;
    project_id: string;
    engine_version: string;
    as_of_date: Date;
    inputs_snapshot: Record<string, unknown>;
    results_json: Record<string, unknown>;
    total_low_amount: string;
    total_base_amount: string;
    total_high_amount: string;
    currency: Currency;
    index_base_date: Date;
    computed_at: Date;
  }>(`SELECT * FROM app.fitout_estimate WHERE project_id = $1 ORDER BY computed_at DESC LIMIT 1`, [projectId]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    projectId: row.project_id,
    engineVersion: row.engine_version,
    asOfDate: row.as_of_date.toISOString().slice(0, 10),
    inputsSnapshot: row.inputs_snapshot,
    resultsJson: row.results_json,
    totalLowAmount: Number(row.total_low_amount),
    totalBaseAmount: Number(row.total_base_amount),
    totalHighAmount: Number(row.total_high_amount),
    currency: row.currency,
    indexBaseDate: row.index_base_date.toISOString().slice(0, 10),
    computedAt: row.computed_at.toISOString(),
  };
}

export async function fetchLatestOpexEstimate(client: QueryClient, projectId: string): Promise<OpexEstimate | null> {
  const { rows } = await client.query<{
    id: string;
    project_id: string;
    engine_version: string;
    as_of_date: Date;
    inputs_snapshot: Record<string, unknown>;
    results_json: Record<string, unknown>;
    monthly_low_amount: string;
    monthly_base_amount: string;
    monthly_high_amount: string;
    currency: Currency;
    computed_at: Date;
  }>(`SELECT * FROM app.opex_estimate WHERE project_id = $1 ORDER BY computed_at DESC LIMIT 1`, [projectId]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    projectId: row.project_id,
    engineVersion: row.engine_version,
    asOfDate: row.as_of_date.toISOString().slice(0, 10),
    inputsSnapshot: row.inputs_snapshot,
    resultsJson: row.results_json,
    monthlyLowAmount: Number(row.monthly_low_amount),
    monthlyBaseAmount: Number(row.monthly_base_amount),
    monthlyHighAmount: Number(row.monthly_high_amount),
    currency: row.currency,
    computedAt: row.computed_at.toISOString(),
  };
}

export async function fetchLatestFinancialProjection(client: QueryClient, projectId: string): Promise<FinancialProjection | null> {
  const { rows } = await client.query<{
    id: string;
    project_id: string;
    engine_version: string;
    rule_pack_ids: string[] | null;
    as_of_date: Date;
    fx_usd_dop: string | null;
    inputs_snapshot: Record<string, unknown>;
    results_json: Record<string, unknown>;
    breakeven_month_low: number | null;
    breakeven_month_base: number | null;
    breakeven_month_high: number | null;
    currency: Currency;
    computed_at: Date;
  }>(`SELECT * FROM app.financial_projection WHERE project_id = $1 ORDER BY computed_at DESC LIMIT 1`, [projectId]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    engineVersion: row.engine_version,
    rulePackIds: (row.rule_pack_ids ?? []).map(Number),
    asOfDate: row.as_of_date.toISOString().slice(0, 10),
    fxUsdDop: row.fx_usd_dop === null ? null : Number(row.fx_usd_dop),
    inputsSnapshot: row.inputs_snapshot,
    resultsJson: row.results_json,
    breakevenMonthLow: row.breakeven_month_low,
    breakevenMonthBase: row.breakeven_month_base,
    breakevenMonthHigh: row.breakeven_month_high,
    currency: row.currency,
    computedAt: row.computed_at.toISOString(),
  };
}

/**
 * Every `app.project_assumption` row for the project — the assumptions
 * appendix. Same row shape/mapping as
 * `apps/api/src/projects/projects.repository.ts`'s `mapAssumptionRow`,
 * duplicated rather than imported for the same "each module owns its own
 * reads" reason.
 */
export async function fetchProjectAssumptions(client: QueryClient, projectId: string): Promise<ProjectAssumption[]> {
  const { rows } = await client.query<{
    id: string;
    project_id: string;
    key: string;
    label_es: string;
    unit: string;
    value_low: string;
    value_base: string;
    value_high: string;
    currency: Currency | null;
    provenance: Provenance;
    default_parameter_value_id: string | null;
    is_overridden: boolean;
    implausible_flag: boolean;
    updated_at: Date;
  }>(`SELECT * FROM app.project_assumption WHERE project_id = $1 ORDER BY key`, [projectId]);
  return rows.map((r) => ({
    id: Number(r.id),
    projectId: r.project_id,
    key: r.key,
    labelEs: r.label_es,
    unit: r.unit,
    valueLow: Number(r.value_low),
    valueBase: Number(r.value_base),
    valueHigh: Number(r.value_high),
    currency: r.currency,
    provenance: r.provenance,
    defaultParameterValueId: r.default_parameter_value_id === null ? null : Number(r.default_parameter_value_id),
    isOverridden: r.is_overridden,
    implausibleFlag: r.implausible_flag,
    updatedAt: r.updated_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------
// app.report itself
// ---------------------------------------------------------------------

export interface ReportRow {
  id: string;
  projectId: string;
  requestedBy: string;
  tier: ReportTier;
  status: ReportStatus;
  financialProjectionId: string | null;
  engineVersion: string | null;
  disclaimerDocumentId: number | null;
  storageKey: string | null;
  failureReason: string | null;
  requestedAt: Date;
  completedAt: Date | null;
}

interface RawReportRow {
  id: string;
  project_id: string;
  requested_by: string;
  tier: ReportTier;
  status: ReportStatus;
  financial_projection_id: string | null;
  engine_version: string | null;
  disclaimer_document_id: string | null;
  storage_key: string | null;
  failure_reason: string | null;
  requested_at: Date;
  completed_at: Date | null;
}

function toReportRow(row: RawReportRow): ReportRow {
  return {
    id: row.id,
    projectId: row.project_id,
    requestedBy: row.requested_by,
    tier: row.tier,
    status: row.status,
    financialProjectionId: row.financial_projection_id,
    engineVersion: row.engine_version,
    disclaimerDocumentId: row.disclaimer_document_id === null ? null : Number(row.disclaimer_document_id),
    storageKey: row.storage_key,
    failureReason: row.failure_reason,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
  };
}

export async function insertReport(client: QueryClient, projectId: string, requestedBy: string, tier: ReportTier): Promise<ReportRow> {
  const { rows } = await client.query<RawReportRow>(
    `INSERT INTO app.report (project_id, requested_by, tier, status)
     VALUES ($1, $2, $3, 'queued')
     RETURNING *`,
    [projectId, requestedBy, tier],
  );
  const row = rows[0];
  if (!row) throw new Error("app.report insert returned no row");
  return toReportRow(row);
}

export async function fetchReport(client: QueryClient, projectId: string, reportId: string): Promise<ReportRow | null> {
  const { rows } = await client.query<RawReportRow>(`SELECT * FROM app.report WHERE id = $1 AND project_id = $2`, [
    reportId,
    projectId,
  ]);
  const row = rows[0];
  return row ? toReportRow(row) : null;
}

export async function listReports(client: QueryClient, projectId: string): Promise<ReportRow[]> {
  const { rows } = await client.query<RawReportRow>(`SELECT * FROM app.report WHERE project_id = $1 ORDER BY requested_at DESC`, [
    projectId,
  ]);
  return rows.map(toReportRow);
}

export async function markRendering(client: QueryClient, reportId: string): Promise<void> {
  await client.query(`UPDATE app.report SET status = 'rendering' WHERE id = $1`, [reportId]);
}

export interface MarkReadyInput {
  storageKey: string;
  disclaimerDocumentId: number;
  engineVersion: string;
  financialProjectionId: string | null;
}

export async function markReady(client: QueryClient, reportId: string, input: MarkReadyInput): Promise<void> {
  await client.query(
    `UPDATE app.report
        SET status = 'ready', storage_key = $2, disclaimer_document_id = $3,
            engine_version = $4, financial_projection_id = $5, completed_at = now()
      WHERE id = $1`,
    [reportId, input.storageKey, input.disclaimerDocumentId, input.engineVersion, input.financialProjectionId],
  );
}

/** `failureReason` is truncated to a sane length — an upstream error's message could in principle be arbitrarily long, and `app.report.failure_reason` is meant to be a short, readable diagnosis, not a stack trace dump. */
export async function markFailed(client: QueryClient, reportId: string, failureReason: string): Promise<void> {
  await client.query(`UPDATE app.report SET status = 'failed', failure_reason = $2, completed_at = now() WHERE id = $1`, [
    reportId,
    failureReason.slice(0, 2000),
  ]);
}
