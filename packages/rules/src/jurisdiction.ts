import type { Jurisdiction } from "./types.js";

export class UnknownJurisdictionError extends Error {
  constructor(slug: string) {
    super(`No jurisdiction found with slug "${slug}"`);
    this.name = "UnknownJurisdictionError";
  }
}

export class JurisdictionCycleError extends Error {
  constructor(slug: string) {
    super(`Jurisdiction hierarchy contains a cycle at "${slug}"`);
    this.name = "JurisdictionCycleError";
  }
}

/**
 * Walks `content.jurisdiction`'s self-referencing hierarchy from the given
 * slug up to the root (municipio -> provincia -> nacional), most specific
 * first. This ordering is what lets rule/parameter resolution treat "first
 * match wins" as "most specific jurisdiction wins" without special-casing
 * levels (SODEJA_ARCHITECTURE.md "Rules and rates as data").
 *
 * Pure: takes an already-fetched jurisdiction set, does not query for it —
 * matching this package's "the interpreter is handed resolved content"
 * contract (packages/rules/README.md).
 */
export function resolveJurisdictionChain(
  jurisdictions: readonly Jurisdiction[],
  slug: string,
): Jurisdiction[] {
  const bySlug = new Map(jurisdictions.map((j) => [j.slug, j] as const));
  const byId = new Map(jurisdictions.map((j) => [j.id, j] as const));

  const start = bySlug.get(slug);
  if (!start) {
    throw new UnknownJurisdictionError(slug);
  }

  const chain: Jurisdiction[] = [];
  const seen = new Set<number>();
  let current: Jurisdiction | undefined = start;
  while (current) {
    if (seen.has(current.id)) {
      throw new JurisdictionCycleError(current.slug);
    }
    seen.add(current.id);
    chain.push(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return chain;
}
