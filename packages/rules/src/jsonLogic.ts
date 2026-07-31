import jsonLogic from "json-logic-js";

/**
 * `content.rule.condition` may be authored by a non-engineer through a future
 * CMS (B-23) and can be malformed, absurdly deep, or simply wrong. Evaluation
 * must degrade to a caught error, never a hang or a crash (SODEJA_RISKS.md
 * T3 / packages/rules/README.md "the governing constraint").
 */
export class RuleEvaluationError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RuleEvaluationError";
  }
}

// A legitimate JSONLogic condition for a permit/tax rule is a handful of
// levels deep. This is not a hard product limit — it is a cheap circuit
// breaker against pathological or corrupted content before it ever reaches
// json-logic-js's recursive evaluator.
const MAX_CONDITION_DEPTH = 24;

function assertBoundedJson(value: unknown, depth: number): void {
  if (depth > MAX_CONDITION_DEPTH) {
    throw new RuleEvaluationError(
      `condition exceeds the maximum nesting depth of ${MAX_CONDITION_DEPTH}`,
    );
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertBoundedJson(item, depth + 1);
    return;
  }
  for (const nested of Object.values(value)) assertBoundedJson(nested, depth + 1);
}

/**
 * Evaluates a JSONLogic condition against a fact set. Deliberately the only
 * seam this package has into json-logic-js: no `eval`, no `Function`
 * construction, no dynamic import — json-logic-js is a pure tree-walking
 * interpreter over a fixed, declarative operator vocabulary (see the README
 * for why that library was chosen over an alternative that compiles rules to
 * JIT-generated JS).
 *
 * Never throws a raw json-logic-js error: any failure — malformed condition
 * shape, an operator given the wrong argument types, excessive nesting — is
 * normalized into a `RuleEvaluationError` so callers can catch one type and
 * degrade gracefully (never crash the API on bad content).
 */
export function evaluateCondition(condition: unknown, facts: Record<string, unknown>): boolean {
  assertBoundedJson(condition, 0);
  try {
    return Boolean(jsonLogic.apply(condition as never, facts));
  } catch (error) {
    throw new RuleEvaluationError(
      `condition failed to evaluate: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
}
