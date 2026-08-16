import { Injectable } from "@nestjs/common";
import { withServiceSession } from "@sodeja/db";
import {
  fetchCitationsByIds,
  fetchParameterValues,
  resolveParameterValue,
  type BusinessType,
  type ParameterTable,
  type ParameterValue,
  type QueryClient,
} from "@sodeja/rules";
import type { BusinessTypeCatalogEntry, Jurisdiction } from "@sodeja/schemas";

async function fetchActiveBusinessTypes(client: QueryClient): Promise<BusinessType[]> {
  const { rows } = await client.query<{
    id: number;
    slug: string;
    name_es: string;
    description_es: string | null;
    is_active: boolean;
    display_order: number;
  }>(
    `SELECT id, slug, name_es, description_es, is_active, display_order
       FROM content.business_type WHERE is_active ORDER BY display_order`,
  );
  // NOT `Number(r.id)` here, deliberately: `content.business_type.id` is
  // `bigserial` (specs/db/schema.sql), so the pg driver actually returns it
  // as a STRING at runtime despite `BusinessType.id`'s `number` type — and
  // `resolveParameterValue` (@sodeja/rules parameters.ts) matches it against
  // `content.parameter_value.business_type_id`, which the SAME driver
  // returns as an equally-unconverted string. Converting only THIS side to a
  // real number would break that `===` match (a real, pre-existing repo-wide
  // pg-bigint-as-string quirk this addition must not disturb). The client
  // response is still a proper number — see `listBusinessTypes`'s final
  // `.map`, which converts once, at the wire boundary, after resolution.
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    nameEs: r.name_es,
    descriptionEs: r.description_es,
    isActive: r.is_active,
    displayOrder: r.display_order,
  }));
}

async function fetchCapacityParameterTables(client: QueryClient): Promise<ParameterTable[]> {
  const { rows } = await client.query<{
    id: number;
    slug: string;
    name_es: string;
    unit: string;
    domain: ParameterTable["domain"];
  }>(`SELECT id, slug, name_es, unit, domain FROM content.parameter_table WHERE domain = 'capacity'`);
  return rows.map((r) => ({ id: r.id, slug: r.slug, nameEs: r.name_es, unit: r.unit, domain: r.domain }));
}

/**
 * B-11: `GET /business-types`. Resolves every `domain='capacity'`
 * `content.parameter_table` against each of the 5 MVP business types, as of
 * today, with NO jurisdiction override — these ratios are national/generic
 * (docs/SODEJA_MVP_BACKLOG.md B-11). A business type with no covered ratio
 * (see the B-11 migration for what was deliberately left uncited) simply
 * yields fewer entries in `parameters`, never a fabricated one.
 *
 * Uses `withServiceSession`, not `withUserSession`: business types and their
 * capacity ratios are shared reference content with RLS disabled
 * (specs/db/schema.sql section 7), not user-owned data — there is no
 * `x-user-id` to require here, mirroring how `@sodeja/rules`' `evaluate.ts`
 * falls back to `withServiceSession` for the exact same reason.
 */
@Injectable()
export class CatalogService {
  async listBusinessTypes(): Promise<BusinessTypeCatalogEntry[]> {
    return withServiceSession(async (client) => {
      const [businessTypes, parameterTables] = await Promise.all([
        fetchActiveBusinessTypes(client),
        fetchCapacityParameterTables(client),
      ]);

      const valuesByTableId = new Map<number, ParameterValue[]>();
      for (const table of parameterTables) {
        valuesByTableId.set(table.id, await fetchParameterValues(client, table.id));
      }
      const citationIds = [...new Set([...valuesByTableId.values()].flat().map((v) => v.citationId))];
      const citationsById = await fetchCitationsByIds(client, citationIds);

      const asOfDate = new Date().toISOString().slice(0, 10);

      return businessTypes.map((businessType) => ({
        // Converted here, once, after `resolveParameterValue` has already
        // matched on the raw (string) id above — see `fetchActiveBusinessTypes`'s
        // comment for why the conversion cannot happen any earlier.
        id: Number(businessType.id),
        slug: businessType.slug,
        nameEs: businessType.nameEs,
        descriptionEs: businessType.descriptionEs,
        parameters: parameterTables
          .map((parameterTable) =>
            resolveParameterValue({
              parameterTable,
              parameterValues: valuesByTableId.get(parameterTable.id) ?? [],
              citationsById,
              asOfDate,
              businessType,
            }),
          )
          .filter((resolved): resolved is NonNullable<typeof resolved> => resolved !== null),
      }));
    });
  }

  /**
   * The smallest addition that unblocks a real Step 4 "choose your metro
   * area" screen: no endpoint listed `content.jurisdiction` rows with usable
   * ids at all before this. Folded into `CatalogService` rather than a new
   * NestJS module — same posture as `listBusinessTypes` (unauthenticated
   * reference content, `withServiceSession`, no RLS), and small enough that a
   * dedicated module would be pure ceremony.
   *
   * Hardcodes the 3 launch-area slugs rather than reusing
   * `geo.repository.ts`'s `LAUNCH_AREA_PROVINCES`: that list is
   * `geo.admin_area.name` (province names, spatial data), a different table
   * keyed by a different string than `content.jurisdiction.slug` — there is
   * no single shared constant to import without introducing a cross-module
   * dependency for three string literals. Both lists are expected to name the
   * same three real places; `packages/db/migrations/1785510924741_seed-rules-content.sql`
   * is the single source of truth for what those places are.
   */
  async listLaunchJurisdictions(): Promise<Jurisdiction[]> {
    return withServiceSession(async (client) => {
      // `content.jurisdiction.id` is also `bigserial` — see
      // `fetchActiveBusinessTypes`'s comment above for why `id` is read as a
      // string and converted with `Number(...)`.
      const { rows } = await client.query<{ id: string; slug: string; name: string }>(
        `SELECT id, slug, name FROM content.jurisdiction
          WHERE slug = ANY($1)
          ORDER BY name`,
        [["distrito-nacional", "santo-domingo", "santiago"]],
      );
      return rows.map((r) => ({ id: Number(r.id), slug: r.slug, nameEs: r.name }));
    });
  }
}
