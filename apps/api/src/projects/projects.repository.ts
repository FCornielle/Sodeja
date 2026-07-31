import type { BusinessType, ParameterTable, QueryClient } from "@sodeja/rules";
import type { Currency, Provenance, ProjectStatus } from "@sodeja/schemas";

export interface ProjectRow {
  id: string;
  name: string;
  businessTypeId: number;
  jurisdictionId: number;
  status: ProjectStatus;
  createdAt: Date;
}

export interface ProjectCoreRow {
  businessTypeId: number | null;
  jurisdictionId: number | null;
}

export interface ProjectAssumptionRow {
  id: number;
  projectId: string;
  key: string;
  labelEs: string;
  unit: string;
  valueLow: number;
  valueBase: number;
  valueHigh: number;
  currency: Currency | null;
  provenance: Provenance;
  defaultParameterValueId: number | null;
  isOverridden: boolean;
  implausibleFlag: boolean;
  updatedAt: Date;
}

// `id` and `default_parameter_value_id` are `bigint`/`bigserial` columns
// (specs/db/schema.sql app.project_assumption): node-postgres returns OID 20
// (int8) as a STRING by default, never a JS number, to avoid silent
// precision loss outside Number.MAX_SAFE_INTEGER. Declared as `string` here
// to match what the driver actually hands back; mapAssumptionRow converts to
// `number` for the outgoing DTO, which is where ProjectAssumptionSchema's
// `z.number()` contract (@sodeja/schemas) is a promise this code must keep.
interface RawAssumptionRow {
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
}

const ASSUMPTION_COLUMNS = `id, project_id, key, label_es, unit, value_low, value_base, value_high,
  currency, provenance, default_parameter_value_id, is_overridden, implausible_flag, updated_at`;

function mapAssumptionRow(r: RawAssumptionRow): ProjectAssumptionRow {
  return {
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
    defaultParameterValueId:
      r.default_parameter_value_id === null ? null : Number(r.default_parameter_value_id),
    isOverridden: r.is_overridden,
    implausibleFlag: r.implausible_flag,
    updatedAt: r.updated_at,
  };
}

/** The user's single MVP-era personal org (specs/db/schema.sql "Tenancy groundwork"). */
export async function findPersonalOrgId(client: QueryClient, userId: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT id FROM app.organization WHERE owner_user_id = $1 AND is_personal",
    [userId],
  );
  return rows[0]?.id ?? null;
}

export async function insertProject(
  client: QueryClient,
  input: { ownerId: string; orgId: string; name: string; businessTypeId: number; jurisdictionId: number },
): Promise<ProjectRow> {
  // business_type_id/jurisdiction_id are `bigint` on app.project — see the
  // RawAssumptionRow comment above for why these come back as strings.
  const { rows } = await client.query<{
    id: string;
    name: string;
    business_type_id: string;
    jurisdiction_id: string;
    status: ProjectStatus;
    created_at: Date;
  }>(
    `INSERT INTO app.project (owner_id, org_id, name, business_type_id, jurisdiction_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, business_type_id, jurisdiction_id, status, created_at`,
    [input.ownerId, input.orgId, input.name, input.businessTypeId, input.jurisdictionId],
  );
  const row = rows[0];
  if (!row) throw new Error("app.project insert returned no row");
  return {
    id: row.id,
    name: row.name,
    businessTypeId: Number(row.business_type_id),
    jurisdictionId: Number(row.jurisdiction_id),
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function fetchProjectCore(
  client: QueryClient,
  projectId: string,
): Promise<ProjectCoreRow | null> {
  const { rows } = await client.query<{
    business_type_id: string | null;
    jurisdiction_id: string | null;
  }>("SELECT business_type_id, jurisdiction_id FROM app.project WHERE id = $1", [projectId]);
  const row = rows[0];
  if (!row) return null;
  return {
    businessTypeId: row.business_type_id === null ? null : Number(row.business_type_id),
    jurisdictionId: row.jurisdiction_id === null ? null : Number(row.jurisdiction_id),
  };
}

export async function fetchBusinessTypeById(
  client: QueryClient,
  id: number,
): Promise<BusinessType | null> {
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

export async function fetchJurisdictionSlugById(client: QueryClient, id: number): Promise<string | null> {
  const { rows } = await client.query<{ slug: string }>(
    "SELECT slug FROM content.jurisdiction WHERE id = $1",
    [id],
  );
  return rows[0]?.slug ?? null;
}

/** Every parameter_table, all domains — see projects.service.ts for why materialization is not capacity-only. */
export async function fetchAllParameterTables(client: QueryClient): Promise<ParameterTable[]> {
  const { rows } = await client.query<{
    id: number;
    slug: string;
    name_es: string;
    unit: string;
    domain: ParameterTable["domain"];
  }>("SELECT id, slug, name_es, unit, domain FROM content.parameter_table");
  return rows.map((r) => ({ id: r.id, slug: r.slug, nameEs: r.name_es, unit: r.unit, domain: r.domain }));
}

export async function fetchParameterValueLowHigh(
  client: QueryClient,
  id: number,
): Promise<{ valueLow: number; valueHigh: number } | null> {
  const { rows } = await client.query<{ value_low: string; value_high: string }>(
    "SELECT value_low, value_high FROM content.parameter_value WHERE id = $1",
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return { valueLow: Number(row.value_low), valueHigh: Number(row.value_high) };
}

/** Walks project_assumption -> its default parameter_value -> that table's domain, for the invalidation map. */
export async function fetchAssumptionDomain(
  client: QueryClient,
  assumptionId: number,
): Promise<ParameterTable["domain"] | null> {
  const { rows } = await client.query<{ domain: ParameterTable["domain"] }>(
    `SELECT pt.domain FROM app.project_assumption pa
       JOIN content.parameter_value pv ON pv.id = pa.default_parameter_value_id
       JOIN content.parameter_table pt ON pt.id = pv.parameter_table_id
      WHERE pa.id = $1`,
    [assumptionId],
  );
  return rows[0]?.domain ?? null;
}

export async function fetchAssumptions(
  client: QueryClient,
  projectId: string,
): Promise<ProjectAssumptionRow[]> {
  const { rows } = await client.query<RawAssumptionRow>(
    `SELECT ${ASSUMPTION_COLUMNS} FROM app.project_assumption WHERE project_id = $1 ORDER BY key`,
    [projectId],
  );
  return rows.map(mapAssumptionRow);
}

export async function fetchAssumptionByKey(
  client: QueryClient,
  projectId: string,
  key: string,
): Promise<ProjectAssumptionRow | null> {
  const { rows } = await client.query<RawAssumptionRow>(
    `SELECT ${ASSUMPTION_COLUMNS} FROM app.project_assumption WHERE project_id = $1 AND key = $2`,
    [projectId, key],
  );
  const row = rows[0];
  return row ? mapAssumptionRow(row) : null;
}

export interface MaterializedAssumption {
  key: string;
  labelEs: string;
  unit: string;
  valueLow: number;
  valueBase: number;
  valueHigh: number;
  currency: Currency | null;
  provenance: Provenance;
  defaultParameterValueId: number;
}

/**
 * One INSERT per row rather than a multi-row statement: materialization
 * touches at most "number of seeded parameter_table rows" (~13 as of
 * B-10+B-11), so simplicity wins over batching here. `ON CONFLICT DO
 * NOTHING` makes this safe to call even if another request raced the same
 * first-read materialization for this project.
 */
export async function insertMaterializedAssumptions(
  client: QueryClient,
  projectId: string,
  materialized: readonly MaterializedAssumption[],
): Promise<ProjectAssumptionRow[]> {
  const results: ProjectAssumptionRow[] = [];
  for (const m of materialized) {
    const { rows } = await client.query<RawAssumptionRow>(
      `INSERT INTO app.project_assumption
         (project_id, key, label_es, unit, value_low, value_base, value_high, currency,
          provenance, default_parameter_value_id, is_overridden, implausible_flag)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, false)
       ON CONFLICT (project_id, key) DO NOTHING
       RETURNING ${ASSUMPTION_COLUMNS}`,
      [
        projectId,
        m.key,
        m.labelEs,
        m.unit,
        m.valueLow,
        m.valueBase,
        m.valueHigh,
        m.currency,
        m.provenance,
        m.defaultParameterValueId,
      ],
    );
    const row = rows[0];
    if (row) results.push(mapAssumptionRow(row));
  }
  return results;
}

export async function updateAssumptionOverride(
  client: QueryClient,
  assumptionId: number,
  input: { valueLow: number; valueBase: number; valueHigh: number; implausibleFlag: boolean },
): Promise<ProjectAssumptionRow> {
  const { rows } = await client.query<RawAssumptionRow>(
    `UPDATE app.project_assumption
        SET value_low = $2, value_base = $3, value_high = $4,
            is_overridden = true, implausible_flag = $5, updated_at = now()
      WHERE id = $1
      RETURNING ${ASSUMPTION_COLUMNS}`,
    [assumptionId, input.valueLow, input.valueBase, input.valueHigh, input.implausibleFlag],
  );
  const row = rows[0];
  if (!row) throw new Error(`app.project_assumption ${assumptionId} update returned no row`);
  return mapAssumptionRow(row);
}
