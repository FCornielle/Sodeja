import type { BusinessType, ParameterTable, QueryClient } from "@sodeja/rules";

/**
 * Minimal project-aggregate read this module needs. Deliberately NOT
 * imported from `../projects/projects.repository.js` — each module owns its
 * own small queries against shared tables (`app.project`, `content.*`),
 * mirroring how `catalog.service.ts` and `projects.repository.ts` already
 * both independently query `content.business_type` rather than one
 * importing the other's repository (apps/api/README.md "Architectural
 * rules": no module reaches into another's internals, even to re-use a
 * query, so each stays independently extractable).
 */
export interface ProjectContext {
  businessTypeId: number | null;
}

export async function fetchProjectContext(client: QueryClient, projectId: string): Promise<ProjectContext | null> {
  const { rows } = await client.query<{ business_type_id: string | null }>(
    "SELECT business_type_id FROM app.project WHERE id = $1",
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;
  return { businessTypeId: row.business_type_id === null ? null : Number(row.business_type_id) };
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

export async function fetchCapacityParameterTables(client: QueryClient): Promise<ParameterTable[]> {
  const { rows } = await client.query<{
    id: number;
    slug: string;
    name_es: string;
    unit: string;
    domain: ParameterTable["domain"];
  }>(`SELECT id, slug, name_es, unit, domain FROM content.parameter_table WHERE domain = 'capacity'`);
  return rows.map((r) => ({ id: r.id, slug: r.slug, nameEs: r.name_es, unit: r.unit, domain: r.domain }));
}

export interface CapacityEstimateRow {
  id: number;
  projectId: string;
  engineVersion: string;
  asOfDate: string;
  inputsSnapshot: Record<string, unknown>;
  resultsJson: Record<string, unknown>;
  seatsLow: number | null;
  seatsBase: number | null;
  seatsHigh: number | null;
  staffLow: number | null;
  staffBase: number | null;
  staffHigh: number | null;
  dailyCustomersLow: number | null;
  dailyCustomersBase: number | null;
  dailyCustomersHigh: number | null;
  computedAt: Date;
}

export interface InsertCapacityEstimateInput {
  engineVersion: string;
  asOfDate: string;
  inputsSnapshot: unknown;
  resultsJson: unknown;
  seatsLow: number | null;
  seatsBase: number | null;
  seatsHigh: number | null;
  staffLow: number | null;
  staffBase: number | null;
  staffHigh: number | null;
  dailyCustomersLow: number | null;
  dailyCustomersBase: number | null;
  dailyCustomersHigh: number | null;
}

export async function insertCapacityEstimate(
  client: QueryClient,
  projectId: string,
  input: InsertCapacityEstimateInput,
): Promise<CapacityEstimateRow> {
  const { rows } = await client.query<{
    id: string;
    project_id: string;
    engine_version: string;
    as_of_date: unknown;
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
  }>(
    `INSERT INTO app.capacity_estimate
       (project_id, engine_version, as_of_date, inputs_snapshot, results_json,
        seats_low, seats_base, seats_high, staff_low, staff_base, staff_high,
        daily_customers_low, daily_customers_base, daily_customers_high)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id, project_id, engine_version, as_of_date, inputs_snapshot, results_json,
               seats_low, seats_base, seats_high, staff_low, staff_base, staff_high,
               daily_customers_low, daily_customers_base, daily_customers_high, computed_at`,
    [
      projectId,
      input.engineVersion,
      input.asOfDate,
      JSON.stringify(input.inputsSnapshot),
      JSON.stringify(input.resultsJson),
      input.seatsLow,
      input.seatsBase,
      input.seatsHigh,
      input.staffLow,
      input.staffBase,
      input.staffHigh,
      input.dailyCustomersLow,
      input.dailyCustomersBase,
      input.dailyCustomersHigh,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("app.capacity_estimate insert returned no row");
  return {
    id: Number(row.id),
    projectId: row.project_id,
    engineVersion: row.engine_version,
    asOfDate: String(row.as_of_date instanceof Date ? row.as_of_date.toISOString().slice(0, 10) : row.as_of_date),
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
    computedAt: row.computed_at,
  };
}
