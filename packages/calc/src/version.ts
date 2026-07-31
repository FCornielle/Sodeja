/**
 * Bumped whenever a computation this engine performs changes in a way that
 * would change a previously-generated number. Every stored projection
 * records this alongside its input snapshot, so a report generated in March
 * regenerates identically in November after the engine has changed — history
 * is never silently recomputed with a newer engine version
 * (SODEJA_ARCHITECTURE.md "@sodeja/calc"; risk T6).
 */
export const ENGINE_VERSION = "1.0.0";

export interface EngineSnapshot<TInputs, TResult> {
  readonly engineVersion: string;
  readonly asOfDate: string;
  readonly inputsSnapshot: TInputs;
  readonly result: TResult;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Wraps a computation's inputs and result in an immutable, versioned
 * envelope — the mechanism that makes a stored projection reproducible.
 *
 * `inputsSnapshot` and `result` are deep-cloned via `structuredClone` before
 * freezing: a caller mutating the object they originally passed in cannot
 * retroactively corrupt an already-produced snapshot, and the returned
 * envelope (and everything reachable from it) is deep-frozen so nothing can
 * mutate it after the fact either. This is the entire "immutable" half of
 * this package's non-negotiable properties — pure computation (no I/O, no
 * clock, no randomness) is the other half, upheld throughout the rest of the
 * package rather than by this function.
 */
export function snapshot<TInputs, TResult>(
  asOfDate: string,
  inputs: TInputs,
  result: TResult,
): EngineSnapshot<TInputs, TResult> {
  return deepFreeze({
    engineVersion: ENGINE_VERSION,
    asOfDate,
    inputsSnapshot: structuredClone(inputs),
    result: structuredClone(result),
  });
}
