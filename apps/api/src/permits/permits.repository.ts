import type { QueryClient } from "@sodeja/rules";

/**
 * The minimal project-aggregate reads this module needs. Deliberately NOT
 * imported from `../costs/costs.repository.js` even though two of these
 * queries are near-identical — each module owns its own small queries against
 * the shared `app.project` / `content.*` tables so each stays independently
 * extractable (apps/api/README.md "Architectural rules"; see
 * capacity.repository.ts's own doc comment for the same reasoning).
 *
 * Nothing here writes. `app.permit_checklist_item` exists in the schema but
 * is not populated by this module — see permits.service.ts's header for why
 * materialization was left out of B-18.
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

export async function fetchBusinessTypeSlugById(client: QueryClient, id: number): Promise<string | null> {
  const { rows } = await client.query<{ slug: string }>("SELECT slug FROM content.business_type WHERE id = $1", [id]);
  return rows[0]?.slug ?? null;
}

/**
 * Both the slug (which `evaluatePermits` resolves the jurisdiction chain
 * from) and the display name, in one read — the checklist names the
 * jurisdiction it was produced for, so a user can tell a Santiago checklist
 * from a Distrito Nacional one without decoding a slug.
 */
export interface JurisdictionIdentity {
  slug: string;
  name: string;
}

export async function fetchJurisdictionById(
  client: QueryClient,
  id: number,
): Promise<JurisdictionIdentity | null> {
  const { rows } = await client.query<{ slug: string; name: string }>(
    "SELECT slug, name FROM content.jurisdiction WHERE id = $1",
    [id],
  );
  const row = rows[0];
  return row ? { slug: row.slug, name: row.name } : null;
}
