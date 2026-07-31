import { withServiceSession } from "@sodeja/db";
import type { ResolvedParameter } from "@sodeja/schemas";
import { resolveJurisdictionChain } from "./jurisdiction.js";
import { evaluatePermitRules, type PermitEvaluationResult } from "./permits.js";
import { resolveParameterValue } from "./parameters.js";
import {
  fetchBusinessTypeBySlug,
  fetchCitationsByIds,
  fetchJurisdictions,
  fetchParameterTableBySlug,
  fetchParameterValues,
  fetchPermitContent,
  type QueryClient,
} from "./repository.js";

/**
 * Runs `fn` against a QueryClient: the one the caller provides (e.g. a
 * `withUserSession`-scoped client from an API request), or a fresh
 * `withServiceSession` from `@sodeja/db` otherwise — content tables carry no
 * RLS policy (they are shared reference data, GRANTed to `authenticated`
 * directly; see specs/db/schema.sql section 5), so either session type reads
 * them identically.
 */
async function withClient<T>(
  client: QueryClient | undefined,
  fn: (client: QueryClient) => Promise<T>,
): Promise<T> {
  if (client) return fn(client);
  // pg's PoolClient satisfies QueryClient structurally (a `query(text, values)
  // => Promise<{ rows }>` method); the cast avoids depending on pg's exact
  // generic-method variance, which this package otherwise has no reason to
  // know about.
  return withServiceSession((poolClient) => fn(poolClient as unknown as QueryClient));
}

export interface EvaluatePermitsInput {
  jurisdictionSlug: string;
  asOfDate: string;
  facts: Record<string, unknown>;
  client?: QueryClient;
}

/**
 * End-to-end permit evaluation: fetches the jurisdiction hierarchy and every
 * in-scope rule pack/rule/citation, then hands them to the pure
 * `evaluatePermitRules` interpreter. This is the only place in the package
 * that touches the database — everything it calls into is deterministic and
 * DB-free, per the package's "the interpreter is handed resolved content"
 * design (packages/rules/README.md).
 */
export async function evaluatePermits(input: EvaluatePermitsInput): Promise<PermitEvaluationResult> {
  return withClient(input.client, async (client) => {
    const jurisdictions = await fetchJurisdictions(client);
    const jurisdictionChain = resolveJurisdictionChain(jurisdictions, input.jurisdictionSlug);
    const jurisdictionIds = jurisdictionChain.map((j) => j.id);

    const { rulePacks, rules } = await fetchPermitContent(client, jurisdictionIds);
    const citationIds = [...new Set(rules.map((r) => r.citationId))];
    const citationsById = await fetchCitationsByIds(client, citationIds);

    return evaluatePermitRules({
      jurisdictionChain,
      rulePacks,
      rules,
      citationsById,
      asOfDate: input.asOfDate,
      facts: input.facts,
    });
  });
}

export interface ResolveParameterInput {
  parameterTableSlug: string;
  asOfDate: string;
  businessTypeSlug?: string;
  jurisdictionSlug?: string;
  client?: QueryClient;
}

/**
 * End-to-end parameter resolution: the function `@sodeja/calc` callers use to
 * get a `ResolvedParameter` for a given rate/ratio, business type, and date —
 * this is the B-10/B-16 coupling point (see ResolvedParameterSchema in
 * `@sodeja/schemas`).
 */
export async function resolveParameter(
  input: ResolveParameterInput,
): Promise<ResolvedParameter | null> {
  return withClient(input.client, async (client) => {
    const parameterTable = await fetchParameterTableBySlug(client, input.parameterTableSlug);
    if (!parameterTable) return null;

    const [parameterValues, businessType, jurisdictions] = await Promise.all([
      fetchParameterValues(client, parameterTable.id),
      input.businessTypeSlug ? fetchBusinessTypeBySlug(client, input.businessTypeSlug) : undefined,
      input.jurisdictionSlug ? fetchJurisdictions(client) : undefined,
    ]);

    const jurisdictionChain = input.jurisdictionSlug
      ? resolveJurisdictionChain(jurisdictions ?? [], input.jurisdictionSlug)
      : undefined;

    const citationIds = [...new Set(parameterValues.map((v) => v.citationId))];
    const citationsById = await fetchCitationsByIds(client, citationIds);

    return resolveParameterValue({
      parameterTable,
      parameterValues,
      citationsById,
      asOfDate: input.asOfDate,
      ...(businessType ? { businessType } : {}),
      ...(jurisdictionChain ? { jurisdictionChain } : {}),
    });
  });
}
