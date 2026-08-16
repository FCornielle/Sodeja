import type { BusinessType, ParameterTable, QueryClient } from "@sodeja/rules";

/**
 * Minimal project-aggregate reads this module needs. Deliberately NOT
 * imported from `../capacity/capacity.repository.js` even though two of these
 * queries are character-identical — each module owns its own small queries
 * against shared tables (`app.project`, `content.*`), so each stays
 * independently extractable (apps/api/README.md "Architectural rules"; see
 * capacity.repository.ts's own doc comment for the same reasoning).
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

/**
 * Every `domain='layout'` parameter table, unfiltered by business type — the
 * business-type match happens in `findBestParameterValue`, which is where the
 * whole specificity ranking lives (`packages/rules/src/parameters.ts`).
 * Ordered by slug so the response's `densityParameters` array is stable
 * across calls rather than dependent on physical row order.
 */
export async function fetchLayoutParameterTables(client: QueryClient): Promise<ParameterTable[]> {
  const { rows } = await client.query<{
    id: number;
    slug: string;
    name_es: string;
    unit: string;
    domain: ParameterTable["domain"];
  }>(`SELECT id, slug, name_es, unit, domain FROM content.parameter_table WHERE domain = 'layout' ORDER BY slug`);
  return rows.map((r) => ({ id: r.id, slug: r.slug, nameEs: r.name_es, unit: r.unit, domain: r.domain }));
}

export interface LatestCapacityStaff {
  id: number;
  /** `app.capacity_estimate.staff_base` — null whenever that estimate was computed without a `staffCount`. */
  staffBase: number | null;
}

export async function fetchLatestCapacityStaff(
  client: QueryClient,
  projectId: string,
): Promise<LatestCapacityStaff | null> {
  const { rows } = await client.query<{ id: string; staff_base: number | null }>(
    `SELECT id, staff_base FROM app.capacity_estimate WHERE project_id = $1 ORDER BY computed_at DESC LIMIT 1`,
    [projectId],
  );
  const row = rows[0];
  return row ? { id: Number(row.id), staffBase: row.staff_base } : null;
}
