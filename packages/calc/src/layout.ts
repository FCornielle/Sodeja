import type { ResolvedParameter } from "@sodeja/schemas";
import { parameterToNumericRange } from "./parameterInput.js";
import type { Range } from "./range.js";

/**
 * B-13 (Module 4, layout). Deliberately NOT what B-13's backlog title says.
 *
 * The title reads "layout templates from typology ratios", which implies the
 * system proposes a zone-area split (e.g. "70% sales floor / 30% stockroom").
 * `packages/db/migrations/1785550000000_seed-layout-parameters.sql` seeds
 * exactly zero `content.layout_template` rows and explains why at length: no
 * standards body publishes zone-to-zone AREA PROPORTIONS for these business
 * types. What it does seed are per-zone occupant-load DENSITIES (m2/occupant,
 * IBC Table 1004.5) for storage and commercial-kitchen zones only. A density
 * within a zone cannot yield a proportion between zones.
 *
 * So the zone split here is USER-ENTERED (provenance 'usuario'), which is the
 * path the master plan's Module 4 row already anticipated ("parametric ratio
 * templates + user-entered dimensions... must be labelled"). The cited
 * densities are used for one thing only: an informational, never-blocking
 * plausibility comparison against the user's own allocation, and only for the
 * zones that actually have citation coverage. Zones with no coverage
 * (dining/sales floors, and every zone of a salon) get no comparison at all —
 * that absence is the honest answer, not a gap to paper over.
 *
 * Nothing here is a `Range<T>`: a user's typed-in allocation is one number
 * they entered, not a pessimistic/base/optimistic estimate, and forcing it
 * into the three-point shape would manufacture a spread the user never
 * expressed. The cited density IS three-point (it arrives as a
 * `ResolvedParameter`) and is kept as a `Range<number>` throughout the
 * plausibility check.
 */

export class LayoutAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutAllocationError";
  }
}

// Areas are rounded to 2 decimals to match the precision areas actually have
// everywhere in this system — project.area_sqm and premises.area_sqm are
// numeric(12,2) (packages/db/migrations/1785113194367_initial-schema.sql), not
// the numeric(18,4) money domain. Emitting a zone area to 4 decimals from a
// 2-decimal input would be precision this calculation does not have.
function roundArea(value: number): number {
  return Math.round(value * 100) / 100;
}

// Derived unitless quantities (implied occupant counts, deviation factors) keep
// the engine's standard 4 decimals, same as money.ts's rounding, since they are
// not areas and are never stored in an area column.
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** One zone's share of the premises, exactly as the user entered it. */
export interface LayoutZoneShare {
  slug: string;
  /** 0-100. The shares across all zones must sum to at most 100. */
  sharePercent: number;
}

export interface LayoutZoneAllocation {
  slug: string;
  sharePercent: number;
  areaSqm: number;
}

/**
 * Turns a user's zone percentages into zone areas. Every returned `areaSqm` is
 * `totalAreaSqm * sharePercent / 100`, nothing else — no redistribution of
 * rounding residue between zones, because a redistributed sqm is a number the
 * user cannot trace back to anything they typed. The rounded areas may
 * therefore sum to fractionally less or more than `totalAreaSqm`; that residue
 * is a display artifact of 2-decimal areas, not an allocation.
 *
 * Shares summing to LESS than 100 are legitimate and left alone: the remainder
 * is circulation/unallocated floor, and inflating the entered zones to fill it
 * would silently overstate every zone.
 */
export function allocateLayoutZones(
  totalAreaSqm: number,
  zones: readonly LayoutZoneShare[],
): LayoutZoneAllocation[] {
  if (!Number.isFinite(totalAreaSqm) || totalAreaSqm <= 0) {
    throw new LayoutAllocationError(
      `totalAreaSqm must be a finite, positive number (received ${String(totalAreaSqm)}) — it mirrors ` +
        "the CHECK (area_sqm > 0) constraint the confirmed project area already satisfies.",
    );
  }

  const seen = new Set<string>();
  for (const zone of zones) {
    if (zone.slug.length === 0) {
      throw new LayoutAllocationError("every zone needs a non-empty slug");
    }
    if (seen.has(zone.slug)) {
      throw new LayoutAllocationError(
        `zone "${zone.slug}" appears more than once — two shares for one zone is ambiguous, and ` +
          "summing them silently would hide a data-entry mistake.",
      );
    }
    seen.add(zone.slug);
    if (!Number.isFinite(zone.sharePercent) || zone.sharePercent < 0 || zone.sharePercent > 100) {
      throw new LayoutAllocationError(
        `zone "${zone.slug}" has sharePercent ${String(zone.sharePercent)}; it must be a finite number ` +
          "between 0 and 100.",
      );
    }
  }

  // Rounded to 6 decimals before comparing so that shares a user legitimately
  // typed (33.33 + 33.33 + 33.34) are not rejected by binary-float drift in the
  // 15th decimal place.
  const totalShare = Math.round(zones.reduce((sum, z) => sum + z.sharePercent, 0) * 1e6) / 1e6;
  if (totalShare > 100) {
    throw new LayoutAllocationError(
      `zone shares sum to ${String(totalShare)}%, which exceeds 100% of the premises. A sum below 100% ` +
        "is fine (the remainder is circulation/unallocated floor); above 100% allocates area that does " +
        "not exist.",
    );
  }

  return zones.map((zone) => {
    const areaSqm = roundArea((totalAreaSqm * zone.sharePercent) / 100);
    if (!Number.isFinite(areaSqm)) {
      throw new LayoutAllocationError(`zone "${zone.slug}" produced a non-finite area`);
    }
    return { slug: zone.slug, sharePercent: zone.sharePercent, areaSqm };
  });
}

/**
 * One zone's cited occupant-load density plus the occupant count expected in
 * THAT zone.
 *
 * `expectedOccupants` is deliberately per-zone and supplied by the caller. B-12
 * produces a premises-level seat/occupant range, and mapping that figure onto a
 * specific zone is a product decision, not a calculation: an IBC stockroom
 * occupant load counts the staff working in the stockroom, which is not the
 * same population as the customers the sales floor is sized for. This layer
 * refuses to pick that mapping on the caller's behalf.
 */
export interface LayoutZoneDensityCheck {
  zoneSlug: string;
  /** m2/occupant for this zone — e.g. `layout_m2_por_ocupante_almacen`. Must be unitless (currency null). */
  density: ResolvedParameter;
  /** Occupants expected in this zone. Must be positive; omit the whole check when no defensible figure exists. */
  expectedOccupants: number;
}

export interface LayoutZonePlausibilityNote {
  zoneSlug: string;
  parameterTableSlug: string;
  allocatedAreaSqm: number;
  /** m2/occupant, as cited. */
  sqmPerOccupant: Range<number>;
  expectedOccupants: number;
  /** allocatedAreaSqm / sqmPerOccupant, per bound. */
  impliedOccupants: Range<number>;
  /** impliedOccupants / expectedOccupants, taken at the bound CLOSEST to 1 — the most conservative statement the citation supports. */
  deviationFactor: number;
  direction: "mayor" | "menor";
  toleranceFactor: number;
  /** User-facing Spanish text. Informational; never a gate. */
  message: string;
}

function formatDensity(range: Range<number>): string {
  return range.pessimistic === range.optimistic
    ? `${String(range.pessimistic)} m²/ocupante`
    : `${String(range.pessimistic)}–${String(range.optimistic)} m²/ocupante`;
}

/**
 * Compares each covered zone's user-allocated area against the occupant count
 * that zone's cited density would imply, and returns an informational note per
 * zone where the two diverge by more than `toleranceFactor`.
 *
 * This never throws on an implausible allocation and never blocks anything —
 * the user's real-world layout wins. It throws only on inputs that are
 * structurally wrong (a check naming a zone that was not allocated, a
 * currency-bearing "density", a non-positive divisor).
 *
 * `toleranceFactor` has no default on purpose. No citation, backlog item, or
 * standard in this project states how far an allocation may drift before it is
 * worth mentioning; a default baked in here would be a business threshold
 * masquerading as an engine constant, which this package does not do (README,
 * "Rate-free"). The caller supplies it explicitly.
 *
 * A note is emitted only when EVERY bound of the cited density agrees the
 * allocation is off — i.e. when no reading of the citation can reconcile it.
 */
export function checkLayoutZonePlausibility(
  allocations: readonly LayoutZoneAllocation[],
  checks: readonly LayoutZoneDensityCheck[],
  toleranceFactor: number,
): LayoutZonePlausibilityNote[] {
  if (!Number.isFinite(toleranceFactor) || toleranceFactor < 1) {
    throw new LayoutAllocationError(
      `toleranceFactor must be a finite number of at least 1 (received ${String(toleranceFactor)}); it is ` +
        "the multiple by which an implied aforo may differ from the expected one before it is worth " +
        "mentioning.",
    );
  }

  const byslug = new Map(allocations.map((a) => [a.slug, a]));
  const notes: LayoutZonePlausibilityNote[] = [];

  for (const check of checks) {
    const allocation = byslug.get(check.zoneSlug);
    if (!allocation) {
      throw new LayoutAllocationError(
        `density check names zone "${check.zoneSlug}", which has no allocation — a check that silently ` +
          "matches nothing would read as 'this zone looks fine'.",
      );
    }
    if (check.density.currency !== null) {
      throw new LayoutAllocationError(
        `parameter "${check.density.parameterTableSlug}" carries currency ${check.density.currency}; an ` +
          "occupant-load density is unitless (m2/occupant).",
      );
    }
    if (!Number.isFinite(check.expectedOccupants) || check.expectedOccupants <= 0) {
      throw new LayoutAllocationError(
        `zone "${check.zoneSlug}" has expectedOccupants ${String(check.expectedOccupants)}; it must be ` +
          "finite and positive. When no occupant figure is available for a zone (B-12 resolved no " +
          "capacity ratio, for instance), omit that zone's check rather than passing zero — there is no " +
          "meaningful comparison against nothing.",
      );
    }

    const sqmPerOccupant = parameterToNumericRange(check.density);
    if (sqmPerOccupant.pessimistic <= 0) {
      throw new LayoutAllocationError(
        `parameter "${check.density.parameterTableSlug}" has a non-positive m2/occupant bound ` +
          `(${String(sqmPerOccupant.pessimistic)}); occupant load cannot be derived from it.`,
      );
    }

    // Occupants = area / density is DECREASING in density, so the bound giving
    // the FEWEST occupants comes from the density's HIGH bound. Same inversion
    // apps/api/src/capacity/capacity.service.ts applies for seats, and the same
    // reason range.ts leaves it to the caller.
    const impliedOccupants: Range<number> = {
      pessimistic: round4(allocation.areaSqm / sqmPerOccupant.optimistic),
      base: round4(allocation.areaSqm / sqmPerOccupant.base),
      optimistic: round4(allocation.areaSqm / sqmPerOccupant.pessimistic),
    };
    if (
      !Number.isFinite(impliedOccupants.pessimistic) ||
      !Number.isFinite(impliedOccupants.base) ||
      !Number.isFinite(impliedOccupants.optimistic)
    ) {
      throw new LayoutAllocationError(
        `zone "${check.zoneSlug}" produced a non-finite implied occupant count from area ` +
          `${String(allocation.areaSqm)} m2 and ${String(sqmPerOccupant.base)} m2/occupant.`,
      );
    }

    const lowestDeviation = round4(impliedOccupants.pessimistic / check.expectedOccupants);
    const highestDeviation = round4(impliedOccupants.optimistic / check.expectedOccupants);

    let direction: "mayor" | "menor";
    let deviationFactor: number;
    if (lowestDeviation > toleranceFactor) {
      direction = "mayor";
      deviationFactor = lowestDeviation;
    } else if (highestDeviation < 1 / toleranceFactor) {
      direction = "menor";
      deviationFactor = highestDeviation;
    } else {
      continue;
    }

    const bound = direction === "mayor" ? "al menos" : "a lo sumo";
    const message =
      `El área asignada a la zona "${check.zoneSlug}" (${String(allocation.areaSqm)} m²) permitiría un ` +
      `aforo de ${bound} ${String(deviationFactor)} veces el esperado para esa zona ` +
      `(${String(check.expectedOccupants)} ocupantes), según el estándar internacional citado ` +
      `(${check.density.citation.sourceDocument}; ${formatDensity(sqmPerOccupant)}; parámetro ` +
      `${check.density.parameterTableSlug}). Es una comparación informativa, no un límite: la ` +
      "distribución real del local prevalece.";

    notes.push({
      zoneSlug: check.zoneSlug,
      parameterTableSlug: check.density.parameterTableSlug,
      allocatedAreaSqm: allocation.areaSqm,
      sqmPerOccupant,
      expectedOccupants: check.expectedOccupants,
      impliedOccupants,
      deviationFactor,
      direction,
      toleranceFactor,
      message,
    });
  }

  return notes;
}
