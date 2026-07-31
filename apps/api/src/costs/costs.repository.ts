import type { QueryClient } from "@sodeja/rules";

/**
 * Duplicated, deliberately, rather than imported from `../capacity/` or
 * `../projects/` — see capacity.repository.ts's doc comment for why each
 * module owns its own minimal reads against shared tables.
 */
export interface ProjectContext {
  businessTypeId: number | null;
  jurisdictionId: number | null;
}

export async function fetchProjectContext(client: QueryClient, projectId: string): Promise<ProjectContext | null> {
  const { rows } = await client.query<{ business_type_id: string | null; jurisdiction_id: string | null }>(
    "SELECT business_type_id, jurisdiction_id FROM app.project WHERE id = $1",
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    businessTypeId: row.business_type_id === null ? null : Number(row.business_type_id),
    jurisdictionId: row.jurisdiction_id === null ? null : Number(row.jurisdiction_id),
  };
}

export interface FitoutEstimateRow {
  id: number;
  projectId: string;
  engineVersion: string;
  asOfDate: string;
  inputsSnapshot: Record<string, unknown>;
  resultsJson: Record<string, unknown>;
  totalLowAmount: number;
  totalBaseAmount: number;
  totalHighAmount: number;
  currency: "DOP" | "USD";
  indexBaseDate: string;
  computedAt: Date;
}

export interface InsertFitoutEstimateInput {
  engineVersion: string;
  asOfDate: string;
  inputsSnapshot: unknown;
  resultsJson: unknown;
  totalLowAmount: number;
  totalBaseAmount: number;
  totalHighAmount: number;
  currency: "DOP" | "USD";
  indexBaseDate: string;
}

function toIsoDate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

export async function insertFitoutEstimate(
  client: QueryClient,
  projectId: string,
  input: InsertFitoutEstimateInput,
): Promise<FitoutEstimateRow> {
  const { rows } = await client.query<{
    id: string;
    project_id: string;
    engine_version: string;
    as_of_date: unknown;
    inputs_snapshot: Record<string, unknown>;
    results_json: Record<string, unknown>;
    total_low_amount: string;
    total_base_amount: string;
    total_high_amount: string;
    currency: "DOP" | "USD";
    index_base_date: unknown;
    computed_at: Date;
  }>(
    `INSERT INTO app.fitout_estimate
       (project_id, engine_version, as_of_date, inputs_snapshot, results_json,
        total_low_amount, total_base_amount, total_high_amount, currency, index_base_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, project_id, engine_version, as_of_date, inputs_snapshot, results_json,
               total_low_amount, total_base_amount, total_high_amount, currency, index_base_date, computed_at`,
    [
      projectId,
      input.engineVersion,
      input.asOfDate,
      JSON.stringify(input.inputsSnapshot),
      JSON.stringify(input.resultsJson),
      input.totalLowAmount,
      input.totalBaseAmount,
      input.totalHighAmount,
      input.currency,
      input.indexBaseDate,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("app.fitout_estimate insert returned no row");
  return {
    id: Number(row.id),
    projectId: row.project_id,
    engineVersion: row.engine_version,
    asOfDate: toIsoDate(row.as_of_date),
    inputsSnapshot: row.inputs_snapshot,
    resultsJson: row.results_json,
    totalLowAmount: Number(row.total_low_amount),
    totalBaseAmount: Number(row.total_base_amount),
    totalHighAmount: Number(row.total_high_amount),
    currency: row.currency,
    indexBaseDate: toIsoDate(row.index_base_date),
    computedAt: row.computed_at,
  };
}
