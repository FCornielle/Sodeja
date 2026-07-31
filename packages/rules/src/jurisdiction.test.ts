import { describe, expect, it } from "vitest";
import { JurisdictionCycleError, resolveJurisdictionChain, UnknownJurisdictionError } from "./jurisdiction.js";
import type { Jurisdiction } from "./types.js";

const nacional: Jurisdiction = { id: 1, parentId: null, level: "nacional", slug: "nacional", name: "República Dominicana" };
const santiago: Jurisdiction = { id: 2, parentId: 1, level: "provincia", slug: "santiago", name: "Santiago" };
const santoDomingo: Jurisdiction = {
  id: 3,
  parentId: 1,
  level: "provincia",
  slug: "santo-domingo",
  name: "Santo Domingo",
};
const all = [nacional, santiago, santoDomingo];

describe("resolveJurisdictionChain", () => {
  it("returns the chain most-specific first, ending at the root", () => {
    expect(resolveJurisdictionChain(all, "santiago")).toEqual([santiago, nacional]);
  });

  it("returns a single-element chain for the root itself", () => {
    expect(resolveJurisdictionChain(all, "nacional")).toEqual([nacional]);
  });

  it("throws UnknownJurisdictionError for a slug that does not exist", () => {
    expect(() => resolveJurisdictionChain(all, "la-vega")).toThrow(UnknownJurisdictionError);
  });

  it("throws JurisdictionCycleError rather than looping forever on a cyclic parent chain", () => {
    const a: Jurisdiction = { id: 10, parentId: 11, level: "provincia", slug: "a", name: "A" };
    const b: Jurisdiction = { id: 11, parentId: 10, level: "provincia", slug: "b", name: "B" };
    expect(() => resolveJurisdictionChain([a, b], "a")).toThrow(JurisdictionCycleError);
  });
});
