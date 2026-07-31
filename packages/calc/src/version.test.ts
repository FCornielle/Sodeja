import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, snapshot } from "./version.js";

describe("snapshot", () => {
  it("stamps the current ENGINE_VERSION and given asOfDate", () => {
    const env = snapshot("2026-07-31", { areaSqm: 120 }, { capacity: 40 });
    expect(env.engineVersion).toBe(ENGINE_VERSION);
    expect(env.asOfDate).toBe("2026-07-31");
    expect(env.inputsSnapshot).toEqual({ areaSqm: 120 });
    expect(env.result).toEqual({ capacity: 40 });
  });

  it("is deeply frozen: mutating any nested field throws in strict mode / is a silent no-op", () => {
    const env = snapshot("2026-07-31", { nested: { a: 1 } }, { nested: { b: 2 } });
    expect(Object.isFrozen(env)).toBe(true);
    expect(Object.isFrozen(env.inputsSnapshot)).toBe(true);
    expect(Object.isFrozen(env.inputsSnapshot.nested)).toBe(true);
    expect(Object.isFrozen(env.result)).toBe(true);
    expect(() => {
      (env as { engineVersion: string }).engineVersion = "9.9.9";
    }).toThrow();
  });

  it("decouples the snapshot from the caller's original object: later mutation of the input does not affect it", () => {
    const inputs = { areaSqm: 100 };
    const env = snapshot("2026-07-31", inputs, { capacity: 30 });
    inputs.areaSqm = 999;
    expect(env.inputsSnapshot.areaSqm).toBe(100);
  });

  it("round-trips exactly through JSON for arbitrary plain-object inputs/results", () => {
    const plainValue = fc.oneof(
      fc.string(),
      fc.double({ noNaN: true }),
      fc.boolean(),
      fc.constant(null),
    );
    const plainObject = fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), plainValue, {
      maxKeys: 5,
    });

    fc.assert(
      fc.property(fc.string(), plainObject, plainObject, (asOfDate, inputs, result) => {
        const env = snapshot(asOfDate, inputs, result);
        const roundTripped = JSON.parse(JSON.stringify(env));
        expect(roundTripped).toEqual(JSON.parse(JSON.stringify({ engineVersion: ENGINE_VERSION, asOfDate, inputsSnapshot: inputs, result })));
      }),
    );
  });
});
