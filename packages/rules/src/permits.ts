import type { Citation } from "@sodeja/schemas";
import { toCitation } from "./citation.js";
import { evaluateCondition, RuleEvaluationError } from "./jsonLogic.js";
import type { CitationRow, Jurisdiction, Rule, RulePack } from "./types.js";

export interface PermitRuleResult {
  ruleCode: string;
  titleEs: string;
  descriptionEs: string | null;
  /** 'required' / 'likely_required' / 'not_applicable' / 'unknown' — never 'compliant' (risk L3). */
  requirement: "required" | "likely_required" | "not_applicable" | "unknown";
  agencyName: string | null;
  citation: Citation;
  effectiveFrom: string;
  effectiveTo: string | null;
  jurisdictionSlug: string;
  rulePackVersion: number;
}

export interface PermitRuleFailure {
  ruleCode: string;
  rulePackId: number;
  message: string;
}

export interface PermitEvaluationResult {
  results: PermitRuleResult[];
  /** Rules that could not be evaluated (malformed content, missing citation) — never silently dropped. */
  failures: PermitRuleFailure[];
}

export interface EvaluatePermitRulesInput {
  /** Most-specific-first, as returned by resolveJurisdictionChain. */
  jurisdictionChain: readonly Jurisdiction[];
  /** All 'permits'-domain rule packs visible to this jurisdiction chain, any status/date. */
  rulePacks: readonly RulePack[];
  /** All rules belonging to those rule packs. */
  rules: readonly Rule[];
  citationsById: ReadonlyMap<number, CitationRow>;
  asOfDate: string;
  facts: Record<string, unknown>;
}

function isPackInForce(pack: RulePack, asOfDate: string): boolean {
  if (pack.domain !== "permits" || pack.status !== "published") return false;
  if (pack.validFrom > asOfDate) return false;
  if (pack.validTo !== null && pack.validTo <= asOfDate) return false;
  return true;
}

/**
 * Picks, per jurisdiction, the highest-version in-force rule pack — packs are
 * append-only and publishing supersedes rather than mutates (specs/db/schema.sql
 * content.rule_pack), so more than one version can technically overlap.
 */
function selectPacksInForce(
  rulePacks: readonly RulePack[],
  jurisdictionIds: ReadonlySet<number>,
  asOfDate: string,
): Map<number, RulePack> {
  const byJurisdiction = new Map<number, RulePack>();
  for (const pack of rulePacks) {
    if (!jurisdictionIds.has(pack.jurisdictionId)) continue;
    if (!isPackInForce(pack, asOfDate)) continue;
    const current = byJurisdiction.get(pack.jurisdictionId);
    if (!current || pack.version > current.version) {
      byJurisdiction.set(pack.jurisdictionId, pack);
    }
  }
  return byJurisdiction;
}

/**
 * Evaluates every applicable permit rule against `facts`, resolving
 * jurisdiction overrides (a municipal rule with the same `code` as a national
 * one wins) and asOfDate validity, and returns a result for every rule whose
 * condition matched — always carrying its citation and effective date
 * (package README: "citation is mandatory, not decorative").
 *
 * Deterministic and pure: takes fully-resolved content, performs no I/O.
 * A single malformed or uncited rule is isolated into `failures` rather than
 * aborting the whole evaluation or crashing the caller.
 */
export function evaluatePermitRules(input: EvaluatePermitRulesInput): PermitEvaluationResult {
  const { jurisdictionChain, rulePacks, rules, citationsById, asOfDate, facts } = input;

  const specificityRank = new Map<number, number>(
    jurisdictionChain.map((j, index) => [j.id, index] as const),
  );
  const jurisdictionSlugById = new Map(jurisdictionChain.map((j) => [j.id, j.slug] as const));
  const jurisdictionIds = new Set(jurisdictionChain.map((j) => j.id));

  const packsInForce = selectPacksInForce(rulePacks, jurisdictionIds, asOfDate);
  const packsById = new Map(rulePacks.map((p) => [p.id, p] as const));

  const rulesInForce = rules.filter((rule) => {
    const pack = packsById.get(rule.rulePackId);
    return pack !== undefined && packsInForce.get(pack.jurisdictionId)?.id === pack.id;
  });

  // Same `code` can appear in more than one jurisdiction's pack — keep only
  // the most specific (lowest specificityRank) so a municipal rule silently
  // overrides the national default it shares a code with.
  const winnersByCode = new Map<string, Rule>();
  for (const rule of rulesInForce) {
    const pack = packsById.get(rule.rulePackId);
    if (!pack) continue;
    const rank = specificityRank.get(pack.jurisdictionId);
    if (rank === undefined) continue;
    const incumbent = winnersByCode.get(rule.code);
    if (!incumbent) {
      winnersByCode.set(rule.code, rule);
      continue;
    }
    const incumbentPack = packsById.get(incumbent.rulePackId);
    const incumbentRank = incumbentPack ? specificityRank.get(incumbentPack.jurisdictionId) : undefined;
    if (incumbentRank === undefined || rank < incumbentRank) {
      winnersByCode.set(rule.code, rule);
    }
  }

  const results: PermitRuleResult[] = [];
  const failures: PermitRuleFailure[] = [];

  for (const rule of Array.from(winnersByCode.values()).sort(
    (a, b) => a.displayOrder - b.displayOrder,
  )) {
    const pack = packsById.get(rule.rulePackId);
    if (!pack) {
      failures.push({ ruleCode: rule.code, rulePackId: rule.rulePackId, message: "rule pack not found" });
      continue;
    }

    let matched: boolean;
    try {
      matched = evaluateCondition(rule.condition, facts);
    } catch (error) {
      const message = error instanceof RuleEvaluationError ? error.message : String(error);
      failures.push({ ruleCode: rule.code, rulePackId: pack.id, message });
      continue;
    }
    if (!matched) continue;

    const citationRow = citationsById.get(rule.citationId);
    if (!citationRow) {
      failures.push({
        ruleCode: rule.code,
        rulePackId: pack.id,
        message: `citation ${rule.citationId} not found`,
      });
      continue;
    }

    let citation: Citation;
    try {
      citation = toCitation(citationRow);
    } catch (error) {
      failures.push({
        ruleCode: rule.code,
        rulePackId: pack.id,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    results.push({
      ruleCode: rule.code,
      titleEs: rule.titleEs,
      descriptionEs: rule.descriptionEs,
      requirement: rule.requirement ?? "unknown",
      agencyName: rule.agencyName,
      citation,
      effectiveFrom: pack.validFrom,
      effectiveTo: pack.validTo,
      jurisdictionSlug: jurisdictionSlugById.get(pack.jurisdictionId) ?? "",
      rulePackVersion: pack.version,
    });
  }

  return { results, failures };
}
