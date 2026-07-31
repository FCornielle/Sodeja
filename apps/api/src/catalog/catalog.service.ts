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
import type { BusinessTypeCatalogEntry } from "@sodeja/schemas";

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
}
