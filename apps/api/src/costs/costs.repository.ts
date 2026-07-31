import type { BusinessType, QueryClient } from "@sodeja/rules";

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

export async function fetchBusinessTypeById(client: QueryClient, id: number): Promise<BusinessType | null> {
  const { rows } = await client.query<{
    id: number;
    slug: string;
    name_es: string;
    description_es: string | null;
    is_active: boolean;
    display_order: number;
  }>(
    "SELECT id, slug, name_es, description_es, is_active, display_order FROM content.business_type WHERE id = $1",
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    nameEs: row.name_es,
    descriptionEs: row.description_es,
    isActive: row.is_active,
    displayOrder: row.display_order,
  };
}

/**
 * The B-10 labor parameter_values (salario_minimo_*, tss_employee_*_rate,
 * infotep_employer_rate) are scoped to jurisdiction 'nacional', NOT
 * jurisdiction_id IS NULL (contrast B-11's capacity ratios, which use NULL —
 * see 1785510924741_seed-rules-content.sql vs. 1785520000000_seed-capacity-
 * parameters.sql). `findBestParameterValue` only matches a jurisdiction-
 * scoped row against jurisdictions present in the supplied chain, so
 * resolving them requires walking the project's own jurisdiction up to
 * 'nacional' first — same as projects.service.ts's getAssumptions does.
 */
export async function fetchJurisdictionSlugById(client: QueryClient, id: number): Promise<string | null> {
  const { rows } = await client.query<{ slug: string }>("SELECT slug FROM content.jurisdiction WHERE id = $1", [id]);
  return rows[0]?.slug ?? null;
}

/**
 * B-15 reads `app.capacity_estimate.staff_*` directly (docs/SODEJA_MVP_BACKLOG.md
 * B-15: "uses app.capacity_estimate.staff_*"). This — like `app.project_location`
 * (`apps/api/src/common/area-gate.ts`) — is shared project-aggregate persisted
 * state, not a NestJS-module-private implementation detail: the "Calculation
 * outputs" block in specs/db/schema.sql documents capacity/fitout/opex/
 * projection as one cohesive group by design, not four independently-owned
 * tables. Read-only; `costs` never writes to `app.capacity_estimate`.
 */
export interface LatestStaffCount {
  staffLow: number | null;
  staffBase: number | null;
  staffHigh: number | null;
}

export async function fetchLatestStaffCount(client: QueryClient, projectId: string): Promise<LatestStaffCount | null> {
  const { rows } = await client.query<{ staff_low: number | null; staff_base: number | null; staff_high: number | null }>(
    `SELECT staff_low, staff_base, staff_high FROM app.capacity_estimate
      WHERE project_id = $1 ORDER BY computed_at DESC LIMIT 1`,
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;
  return { staffLow: row.staff_low, staffBase: row.staff_base, staffHigh: row.staff_high };
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

export interface OpexEstimateRow {
  id: number;
  projectId: string;
  engineVersion: string;
  asOfDate: string;
  inputsSnapshot: Record<string, unknown>;
  resultsJson: Record<string, unknown>;
  monthlyLowAmount: number;
  monthlyBaseAmount: number;
  monthlyHighAmount: number;
  currency: "DOP" | "USD";
  computedAt: Date;
}

export interface InsertOpexEstimateInput {
  engineVersion: string;
  asOfDate: string;
  inputsSnapshot: unknown;
  resultsJson: unknown;
  monthlyLowAmount: number;
  monthlyBaseAmount: number;
  monthlyHighAmount: number;
  currency: "DOP" | "USD";
}

export async function insertOpexEstimate(
  client: QueryClient,
  projectId: string,
  input: InsertOpexEstimateInput,
): Promise<OpexEstimateRow> {
  const { rows } = await client.query<{
    id: string;
    project_id: string;
    engine_version: string;
    as_of_date: unknown;
    inputs_snapshot: Record<string, unknown>;
    results_json: Record<string, unknown>;
    monthly_low_amount: string;
    monthly_base_amount: string;
    monthly_high_amount: string;
    currency: "DOP" | "USD";
    computed_at: Date;
  }>(
    `INSERT INTO app.opex_estimate
       (project_id, engine_version, as_of_date, inputs_snapshot, results_json,
        monthly_low_amount, monthly_base_amount, monthly_high_amount, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, project_id, engine_version, as_of_date, inputs_snapshot, results_json,
               monthly_low_amount, monthly_base_amount, monthly_high_amount, currency, computed_at`,
    [
      projectId,
      input.engineVersion,
      input.asOfDate,
      JSON.stringify(input.inputsSnapshot),
      JSON.stringify(input.resultsJson),
      input.monthlyLowAmount,
      input.monthlyBaseAmount,
      input.monthlyHighAmount,
      input.currency,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("app.opex_estimate insert returned no row");
  return {
    id: Number(row.id),
    projectId: row.project_id,
    engineVersion: row.engine_version,
    asOfDate: toIsoDate(row.as_of_date),
    inputsSnapshot: row.inputs_snapshot,
    resultsJson: row.results_json,
    monthlyLowAmount: Number(row.monthly_low_amount),
    monthlyBaseAmount: Number(row.monthly_base_amount),
    monthlyHighAmount: Number(row.monthly_high_amount),
    currency: row.currency,
    computedAt: row.computed_at,
  };
}
