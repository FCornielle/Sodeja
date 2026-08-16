import type { ResolvedParameter } from "@sodeja/schemas";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  allocateLayoutZones,
  checkLayoutZonePlausibility,
  LayoutAllocationError,
  type LayoutZoneShare,
} from "./layout.js";

// The two figures actually seeded by
// packages/db/migrations/1785550000000_seed-layout-parameters.sql, in the shape
// @sodeja/rules' resolveParameterValue hands them over. low = base = high
// because each is one literal IBC Table 1004.5 row, not a range.
const almacenDensity: ResolvedParameter = {
  parameterTableSlug: "layout_m2_por_ocupante_almacen",
  businessTypeSlug: "colmado",
  valueLow: 27.87,
  valueBase: 27.87,
  valueHigh: 27.87,
  currency: null,
  citation: {
    sourceName: "International Code Council (ICC)",
    sourceDocument:
      "International Building Code (IBC) — Table 1004.5, Maximum Floor Area Allowances Per Occupant",
    article: "Table 1004.5 — Storage, stock, shipping areas",
    retrievedAt: "2026-08-16T00:00:00.000Z",
  },
  provenance: "estimado",
  validFrom: "2026-08-16T00:00:00.000Z",
};

const cocinaDensity: ResolvedParameter = {
  ...almacenDensity,
  parameterTableSlug: "layout_m2_por_ocupante_cocina",
  businessTypeSlug: "restaurante",
  valueLow: 18.58,
  valueBase: 18.58,
  valueHigh: 18.58,
};

describe("allocateLayoutZones", () => {
  it("converts user-entered percentages into zone areas", () => {
    expect(
      allocateLayoutZones(100, [
        { slug: "venta", sharePercent: 70 },
        { slug: "almacen", sharePercent: 30 },
      ]),
    ).toEqual([
      { slug: "venta", sharePercent: 70, areaSqm: 70 },
      { slug: "almacen", sharePercent: 30, areaSqm: 30 },
    ]);
  });

  it("accepts shares summing to less than 100 and leaves the remainder unallocated", () => {
    const allocations = allocateLayoutZones(200, [
      { slug: "venta", sharePercent: 50 },
      { slug: "almacen", sharePercent: 20 },
    ]);
    // Not inflated to 200: the missing 30% is circulation the user did not
    // assign, and spreading it across the entered zones would overstate both.
    expect(allocations.map((a) => a.areaSqm)).toEqual([100, 40]);
  });

  it("rejects shares summing above 100%", () => {
    expect(() =>
      allocateLayoutZones(100, [
        { slug: "venta", sharePercent: 70 },
        { slug: "almacen", sharePercent: 40 },
      ]),
    ).toThrow(LayoutAllocationError);
  });

  it("does not reject a legitimate 33.33/33.33/33.34 split over float drift", () => {
    const allocations = allocateLayoutZones(90, [
      { slug: "a", sharePercent: 33.33 },
      { slug: "b", sharePercent: 33.33 },
      { slug: "c", sharePercent: 33.34 },
    ]);
    expect(allocations.map((a) => a.areaSqm)).toEqual([30, 30, 30.01]);
  });

  it("rejects a duplicated zone slug rather than summing the two shares", () => {
    expect(() =>
      allocateLayoutZones(100, [
        { slug: "almacen", sharePercent: 20 },
        { slug: "almacen", sharePercent: 20 },
      ]),
    ).toThrow(LayoutAllocationError);
  });

  it("rejects an empty zone slug", () => {
    expect(() => allocateLayoutZones(100, [{ slug: "", sharePercent: 20 }])).toThrow(LayoutAllocationError);
  });

  it.each([0, -50, Number.NaN, Number.POSITIVE_INFINITY])("rejects totalAreaSqm %s", (total) => {
    expect(() => allocateLayoutZones(total, [{ slug: "venta", sharePercent: 50 }])).toThrow(
      LayoutAllocationError,
    );
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])("rejects sharePercent %s", (share) => {
    expect(() => allocateLayoutZones(100, [{ slug: "venta", sharePercent: share }])).toThrow(
      LayoutAllocationError,
    );
  });

  it("allows a zero-share zone (an entered zone the user gave no area)", () => {
    expect(allocateLayoutZones(100, [{ slug: "almacen", sharePercent: 0 }])).toEqual([
      { slug: "almacen", sharePercent: 0, areaSqm: 0 },
    ]);
  });

  it("returns nothing for no zones", () => {
    expect(allocateLayoutZones(100, [])).toEqual([]);
  });
});

const zonesArb = fc
  .array(fc.double({ min: 0, max: 100, noNaN: true }), { minLength: 1, maxLength: 6 })
  .map((raw) => {
    // Normalise an arbitrary vector down to a total of at most 100 so the
    // property covers the accepted domain rather than the rejection path.
    const sum = raw.reduce((a, b) => a + b, 0);
    const scale = sum > 100 ? 100 / sum : 1;
    return raw.map((share, i): LayoutZoneShare => ({ slug: `zona-${String(i)}`, sharePercent: share * scale }));
  });

const totalAreaArb = fc.double({ min: 1, max: 100000, noNaN: true });

describe("allocateLayoutZones — properties", () => {
  it("never allocates more area than the premises has", () => {
    fc.assert(
      fc.property(totalAreaArb, zonesArb, (total, zones) => {
        const allocated = allocateLayoutZones(total, zones).reduce((s, a) => s + a.areaSqm, 0);
        // Tolerance covers only the per-zone 2-decimal rounding, nothing more.
        expect(allocated).toBeLessThanOrEqual(total + 0.005 * zones.length);
      }),
    );
  });

  it("gives every zone an area traceable to its own share alone", () => {
    fc.assert(
      fc.property(totalAreaArb, zonesArb, (total, zones) => {
        for (const allocation of allocateLayoutZones(total, zones)) {
          expect(allocation.areaSqm).toBe(Math.round(((total * allocation.sharePercent) / 100) * 100) / 100);
        }
      }),
    );
  });

  it("orders zone areas the same way as their shares", () => {
    fc.assert(
      fc.property(totalAreaArb, zonesArb, (total, zones) => {
        const allocations = allocateLayoutZones(total, zones);
        for (const a of allocations) {
          for (const b of allocations) {
            if (a.sharePercent < b.sharePercent) expect(a.areaSqm).toBeLessThanOrEqual(b.areaSqm);
          }
        }
      }),
    );
  });

  it("always rejects a set of shares summing above 100%", () => {
    fc.assert(
      fc.property(
        totalAreaArb,
        fc.array(fc.double({ min: 0.01, max: 100, noNaN: true }), { minLength: 1, maxLength: 6 }),
        (total, raw) => {
          fc.pre(raw.reduce((a, b) => a + b, 0) > 100.000001);
          const zones = raw.map((s, i) => ({ slug: `zona-${String(i)}`, sharePercent: s }));
          expect(() => allocateLayoutZones(total, zones)).toThrow(LayoutAllocationError);
        },
      ),
    );
  });
});

describe("checkLayoutZonePlausibility", () => {
  // 27.87 m2/occupant x 10 occupants = 278.7 m2 is the allocation the citation
  // would call exactly right for a 10-person stockroom.
  const allocationsFor = (almacenAreaSqm: number) =>
    allocateLayoutZones(1000, [{ slug: "almacen", sharePercent: almacenAreaSqm / 10 }]);

  it("says nothing when the allocation matches the cited density", () => {
    const notes = checkLayoutZonePlausibility(
      allocationsFor(278.7),
      [{ zoneSlug: "almacen", density: almacenDensity, expectedOccupants: 10 }],
      2,
    );
    expect(notes).toEqual([]);
  });

  it("says nothing while the divergence stays inside the tolerance", () => {
    // 460 m2 implies ~16.5 occupants against an expected 10 — 1.65x, under 2x.
    expect(
      checkLayoutZonePlausibility(
        allocationsFor(460),
        [{ zoneSlug: "almacen", density: almacenDensity, expectedOccupants: 10 }],
        2,
      ),
    ).toEqual([]);
  });

  it("flags an over-large zone as informational, with the numbers behind it", () => {
    const notes = checkLayoutZonePlausibility(
      allocationsFor(900),
      [{ zoneSlug: "almacen", density: almacenDensity, expectedOccupants: 10 }],
      2,
    );
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note?.direction).toBe("mayor");
    expect(note?.allocatedAreaSqm).toBe(900);
    expect(note?.impliedOccupants).toEqual({ pessimistic: 32.2928, base: 32.2928, optimistic: 32.2928 });
    expect(note?.deviationFactor).toBe(3.2293);
    expect(note?.parameterTableSlug).toBe("layout_m2_por_ocupante_almacen");
    expect(note?.message).toContain("al menos 3.2293 veces");
    expect(note?.message).toContain("Table 1004.5");
    expect(note?.message).toContain("comparación informativa, no un límite");
  });

  it("flags an under-sized zone in the other direction", () => {
    const notes = checkLayoutZonePlausibility(
      allocationsFor(50),
      [{ zoneSlug: "almacen", density: almacenDensity, expectedOccupants: 10 }],
      2,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.direction).toBe("menor");
    expect(notes[0]?.deviationFactor).toBeLessThan(0.5);
    expect(notes[0]?.message).toContain("a lo sumo");
  });

  it("leaves uncovered zones alone instead of inventing a check for them", () => {
    // 700 m2 of stockroom against an expected 10 occupants is ~2.5x the cited
    // density, so 'almacen' does produce a note — 'venta' stays silent because
    // no sales-floor density is seeded, not because it looks fine.
    const allocations = allocateLayoutZones(1000, [
      { slug: "venta", sharePercent: 20 },
      { slug: "almacen", sharePercent: 70 },
    ]);
    const notes = checkLayoutZonePlausibility(
      allocations,
      // Only 'almacen' has a seeded density; 'venta' has none and gets none.
      [{ zoneSlug: "almacen", density: almacenDensity, expectedOccupants: 10 }],
      2,
    );
    expect(notes.map((n) => n.zoneSlug)).toEqual(["almacen"]);
  });

  it("returns nothing at all for a business type with no layout coverage (salon)", () => {
    const salon = allocateLayoutZones(80, [
      { slug: "estaciones", sharePercent: 60 },
      { slug: "espera", sharePercent: 20 },
    ]);
    expect(checkLayoutZonePlausibility(salon, [], 2)).toEqual([]);
  });

  it("uses the kitchen density for a restaurante kitchen zone", () => {
    const notes = checkLayoutZonePlausibility(
      allocateLayoutZones(200, [{ slug: "cocina", sharePercent: 5 }]),
      [{ zoneSlug: "cocina", density: cocinaDensity, expectedOccupants: 4 }],
      2,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.parameterTableSlug).toBe("layout_m2_por_ocupante_cocina");
    expect(notes[0]?.direction).toBe("menor");
  });

  it("only flags when every bound of a spread density agrees", () => {
    const spread: ResolvedParameter = { ...almacenDensity, valueLow: 10, valueBase: 27.87, valueHigh: 60 };
    const allocations = allocationsFor(600);
    // The high bound implies 10 occupants (exactly expected), so no reading of
    // the citation condemns this allocation.
    expect(
      checkLayoutZonePlausibility(
        allocations,
        [{ zoneSlug: "almacen", density: spread, expectedOccupants: 10 }],
        2,
      ),
    ).toEqual([]);
  });

  it("rejects a check naming a zone that was never allocated", () => {
    expect(() =>
      checkLayoutZonePlausibility(
        allocationsFor(300),
        [{ zoneSlug: "cocina", density: cocinaDensity, expectedOccupants: 4 }],
        2,
      ),
    ).toThrow(LayoutAllocationError);
  });

  it("rejects a currency-bearing parameter posing as a density", () => {
    const priced: ResolvedParameter = { ...almacenDensity, currency: "DOP" };
    expect(() =>
      checkLayoutZonePlausibility(
        allocationsFor(300),
        [{ zoneSlug: "almacen", density: priced, expectedOccupants: 10 }],
        2,
      ),
    ).toThrow(LayoutAllocationError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects expectedOccupants %s", (occupants) => {
    expect(() =>
      checkLayoutZonePlausibility(
        allocationsFor(300),
        [{ zoneSlug: "almacen", density: almacenDensity, expectedOccupants: occupants }],
        2,
      ),
    ).toThrow(LayoutAllocationError);
  });

  it("rejects a zero m2/occupant density rather than dividing by it", () => {
    const zero: ResolvedParameter = { ...almacenDensity, valueLow: 0, valueBase: 0, valueHigh: 0 };
    expect(() =>
      checkLayoutZonePlausibility(
        allocationsFor(300),
        [{ zoneSlug: "almacen", density: zero, expectedOccupants: 10 }],
        2,
      ),
    ).toThrow(LayoutAllocationError);
  });

  it.each([0, 0.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects toleranceFactor %s", (tolerance) => {
    expect(() =>
      checkLayoutZonePlausibility(
        allocationsFor(300),
        [{ zoneSlug: "almacen", density: almacenDensity, expectedOccupants: 10 }],
        tolerance,
      ),
    ).toThrow(LayoutAllocationError);
  });
});

describe("checkLayoutZonePlausibility — properties", () => {
  const occupantsArb = fc.double({ min: 1, max: 500, noNaN: true });
  const toleranceArb = fc.double({ min: 1, max: 20, noNaN: true });

  it("never flags an allocation sized exactly to the cited density", () => {
    // Tolerance stays clear of exactly 1: an area is rounded to 2 decimals, so
    // a "perfectly sized" zone is off by up to half a cm2, and a caller asking
    // for literally zero tolerance is correctly told about even that.
    const usableToleranceArb = fc.double({ min: 1.01, max: 20, noNaN: true });
    fc.assert(
      fc.property(occupantsArb, usableToleranceArb, (occupants, tolerance) => {
        const areaSqm = Math.round(occupants * 27.87 * 100) / 100;
        const allocations = [{ slug: "almacen", sharePercent: 100, areaSqm }];
        expect(
          checkLayoutZonePlausibility(
            allocations,
            [{ zoneSlug: "almacen", density: almacenDensity, expectedOccupants: occupants }],
            tolerance,
          ),
        ).toEqual([]);
      }),
    );
  });

  it("is monotonic in the tolerance: a looser tolerance never adds notes", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 5000, noNaN: true }),
        occupantsArb,
        toleranceArb,
        fc.double({ min: 0, max: 10, noNaN: true }),
        (areaSqm, occupants, tolerance, slack) => {
          const allocations = [
            { slug: "almacen", sharePercent: 100, areaSqm: Math.round(areaSqm * 100) / 100 },
          ];
          const check = [{ zoneSlug: "almacen", density: almacenDensity, expectedOccupants: occupants }];
          const tight = checkLayoutZonePlausibility(allocations, check, tolerance);
          const loose = checkLayoutZonePlausibility(allocations, check, tolerance + slack);
          expect(loose.length).toBeLessThanOrEqual(tight.length);
        },
      ),
    );
  });

  it("emits at most one note per checked zone and never touches unchecked ones", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 5000, noNaN: true }),
        occupantsArb,
        toleranceArb,
        (areaSqm, occupants, tolerance) => {
          const allocations = [
            { slug: "almacen", sharePercent: 50, areaSqm: Math.round(areaSqm * 100) / 100 },
            { slug: "venta", sharePercent: 50, areaSqm: Math.round(areaSqm * 100) / 100 },
          ];
          const notes = checkLayoutZonePlausibility(
            allocations,
            [{ zoneSlug: "almacen", density: almacenDensity, expectedOccupants: occupants }],
            tolerance,
          );
          expect(notes.length).toBeLessThanOrEqual(1);
          expect(notes.every((n) => n.zoneSlug === "almacen")).toBe(true);
        },
      ),
    );
  });
});
