import type {
  BusinessType,
  CitationRow,
  Jurisdiction,
  ParameterTable,
  ParameterValue,
  Rule,
  RulePack,
} from "./types.js";

/**
 * The minimal query surface this package needs from a DB client — matches
 * `pg`'s `Pool`/`PoolClient`/`withServiceSession` callback shape from
 * `@sodeja/db` without importing `pg` directly, so this module stays testable
 * against a plain mock.
 */
export interface QueryClient {
  query<Row extends object = never>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

export async function fetchJurisdictions(client: QueryClient): Promise<Jurisdiction[]> {
  const { rows } = await client.query<{
    id: number;
    parent_id: number | null;
    level: Jurisdiction["level"];
    slug: string;
    name: string;
  }>("SELECT id, parent_id, level, slug, name FROM content.jurisdiction");
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    level: r.level,
    slug: r.slug,
    name: r.name,
  }));
}

export async function fetchBusinessTypeBySlug(
  client: QueryClient,
  slug: string,
): Promise<BusinessType | null> {
  const { rows } = await client.query<{
    id: number;
    slug: string;
    name_es: string;
    description_es: string | null;
    is_active: boolean;
    display_order: number;
  }>(
    "SELECT id, slug, name_es, description_es, is_active, display_order FROM content.business_type WHERE slug = $1",
    [slug],
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

export async function fetchCitationsByIds(
  client: QueryClient,
  ids: readonly number[],
): Promise<Map<number, CitationRow>> {
  const map = new Map<number, CitationRow>();
  if (ids.length === 0) return map;
  const { rows } = await client.query<{
    id: number;
    source_name: string;
    document_title: string;
    article_ref: string | null;
    source_url: string | null;
    published_on: unknown;
    retrieved_on: unknown;
    is_verified: boolean;
    verification_note: string | null;
  }>(
    `SELECT id, source_name, document_title, article_ref, source_url, published_on,
            retrieved_on, is_verified, verification_note
       FROM content.citation WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      sourceName: r.source_name,
      documentTitle: r.document_title,
      articleRef: r.article_ref,
      sourceUrl: r.source_url,
      publishedOn: r.published_on ? toIsoDate(r.published_on) : null,
      retrievedOn: toIsoDate(r.retrieved_on),
      isVerified: r.is_verified,
      verificationNote: r.verification_note,
    });
  }
  return map;
}

export async function fetchPermitContent(
  client: QueryClient,
  jurisdictionIds: readonly number[],
): Promise<{ rulePacks: RulePack[]; rules: Rule[] }> {
  if (jurisdictionIds.length === 0) return { rulePacks: [], rules: [] };
  const { rows: packRows } = await client.query<{
    id: number;
    jurisdiction_id: number;
    domain: RulePack["domain"];
    version: number;
    status: RulePack["status"];
    valid_from: unknown;
    valid_to: unknown;
  }>(
    `SELECT id, jurisdiction_id, domain, version, status, valid_from, valid_to
       FROM content.rule_pack
      WHERE domain = 'permits' AND jurisdiction_id = ANY($1::bigint[])`,
    [jurisdictionIds],
  );
  const rulePacks: RulePack[] = packRows.map((r) => ({
    id: r.id,
    jurisdictionId: r.jurisdiction_id,
    domain: r.domain,
    version: r.version,
    status: r.status,
    validFrom: toIsoDate(r.valid_from),
    validTo: r.valid_to ? toIsoDate(r.valid_to) : null,
  }));

  if (rulePacks.length === 0) return { rulePacks: [], rules: [] };
  const packIds = rulePacks.map((p) => p.id);
  const { rows: ruleRows } = await client.query<{
    id: number;
    rule_pack_id: number;
    code: string;
    title_es: string;
    description_es: string | null;
    condition: unknown;
    consequence: unknown;
    requirement: Rule["requirement"];
    agency_name: string | null;
    citation_id: number;
    display_order: number;
  }>(
    `SELECT id, rule_pack_id, code, title_es, description_es, condition, consequence,
            requirement, agency_name, citation_id, display_order
       FROM content.rule WHERE rule_pack_id = ANY($1::bigint[])`,
    [packIds],
  );
  const rules: Rule[] = ruleRows.map((r) => ({
    id: r.id,
    rulePackId: r.rule_pack_id,
    code: r.code,
    titleEs: r.title_es,
    descriptionEs: r.description_es,
    condition: r.condition,
    consequence: r.consequence,
    requirement: r.requirement,
    agencyName: r.agency_name,
    citationId: r.citation_id,
    displayOrder: r.display_order,
  }));

  return { rulePacks, rules };
}

export async function fetchParameterTableBySlug(
  client: QueryClient,
  slug: string,
): Promise<ParameterTable | null> {
  const { rows } = await client.query<{
    id: number;
    slug: string;
    name_es: string;
    unit: string;
    domain: ParameterTable["domain"];
  }>("SELECT id, slug, name_es, unit, domain FROM content.parameter_table WHERE slug = $1", [slug]);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, slug: row.slug, nameEs: row.name_es, unit: row.unit, domain: row.domain };
}

export async function fetchParameterValues(
  client: QueryClient,
  parameterTableId: number,
): Promise<ParameterValue[]> {
  const { rows } = await client.query<{
    id: number;
    parameter_table_id: number;
    business_type_id: number | null;
    jurisdiction_id: number | null;
    value_low: string;
    value_base: string;
    value_high: string;
    currency: ParameterValue["currency"];
    valid_from: unknown;
    valid_to: unknown;
    citation_id: number;
    provenance: ParameterValue["provenance"];
  }>(
    `SELECT id, parameter_table_id, business_type_id, jurisdiction_id, value_low, value_base,
            value_high, currency, valid_from, valid_to, citation_id, provenance
       FROM content.parameter_value WHERE parameter_table_id = $1`,
    [parameterTableId],
  );
  return rows.map((r) => ({
    id: r.id,
    parameterTableId: r.parameter_table_id,
    businessTypeId: r.business_type_id,
    jurisdictionId: r.jurisdiction_id,
    valueLow: Number(r.value_low),
    valueBase: Number(r.value_base),
    valueHigh: Number(r.value_high),
    currency: r.currency,
    validFrom: toIsoDate(r.valid_from),
    validTo: r.valid_to ? toIsoDate(r.valid_to) : null,
    citationId: r.citation_id,
    provenance: r.provenance,
  }));
}
