"use client";

import { useState } from "react";
import type { CapacityEstimate, Provenance, ResolvedParameter } from "@sodeja/schemas";
import { ResolvedParameterSchema } from "@sodeja/schemas";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { CitationLine } from "../common/CitationLine";

interface Props {
  projectId: string;
  onContinue: () => void;
  onBackToConfirm: () => void;
}

type State =
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "done"; estimate: CapacityEstimate }
  | { kind: "gated" }
  | { kind: "error"; message: string };

/**
 * Step 5's capacity half (B-12, Module 6) — "Screen: Capacidad estimada" in
 * specs/ux/flows.md. Sits right after `LayoutZonesStep` and before
 * `MarketStudyStep` in `ProjectFlow.tsx`'s sequence: capacity is the other
 * half of Step 5, and `opex.service.ts` / `layout-parameters`
 * (`expectedOccupants`) both read the latest `app.capacity_estimate.staff_*`
 * when one exists, so producing it earlier in the flow makes those
 * downstream fallbacks the exception rather than the only path. (Layout runs
 * before this screen, so its own `expectedOccupants` plausibility check will
 * still see `null` on a fresh project — reordering `LayoutZonesStep` itself
 * was out of scope for this change.)
 *
 * `staffCount` is the ONLY way this system ever populates a `staff_*` band —
 * no staffing-density ratio is seeded for any business type
 * (`CapacityEstimateRequestSchema`'s own doc comment) — so the form asks for
 * it directly and explains why, rather than silently submitting without it.
 * It is not required to submit (the API accepts an omitted `staffCount` and
 * simply returns `staff_*` as `null` with a reason), but the copy makes that
 * trade-off explicit before the user leaves it blank.
 *
 * No client-side live-recompute here (the spec's "editing a ratio recomputes
 * immediately (client-side `@sodeja/calc`, no round trip)" is a nice-to-have
 * per this task's brief, not required for this pass) — this screen follows
 * every other step's existing pattern instead: enter `staffCount`, submit,
 * see the computed result. The one ratio this screen resolves (the seats
 * ratio) is not user-editable here at all; overriding it is Secondary Flow
 * B's "Supuestos" panel, out of scope for this screen.
 */
export function CapacityEstimateStep({ projectId, onContinue, onBackToConfirm }: Props) {
  const [state, setState] = useState<State>({ kind: "form" });
  const [staffCountText, setStaffCountText] = useState("");

  const staffCount = staffCountText.trim().length > 0 ? Number(staffCountText) : undefined;
  const isValid = staffCount === undefined || (Number.isInteger(staffCount) && staffCount >= 0);

  async function handleSubmit(): Promise<void> {
    if (!isValid) return;
    setState({ kind: "submitting" });
    try {
      const estimate = await apiFetch<CapacityEstimate>(`/projects/${projectId}/capacity-estimate`, {
        method: "POST",
        body: { staffCount },
      });
      setState({ kind: "done", estimate });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setState({ kind: "gated" });
        return;
      }
      setState({
        kind: "error",
        message: err instanceof ApiError ? err.message : "No se pudo calcular la capacidad estimada.",
      });
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-neutral-900">Capacidad estimada</h1>
      <p className="text-sm text-neutral-600">
        Asientos, personal y clientes diarios, todos en banda. Cada razón usada se puede expandir para
        ver su valor, fuente y procedencia.
      </p>

      {state.kind === "gated" && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>Necesitamos el área confirmada antes de estimar la capacidad.</p>
          <button type="button" onClick={onBackToConfirm} className="mt-2 font-medium text-blue-600 underline">
            Volver a confirmar el área
          </button>
        </div>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-red-600" role="alert">
          {state.message}
        </p>
      )}

      {state.kind !== "done" && (
        <fieldset className="flex flex-col gap-2 rounded border border-neutral-200 p-3">
          <label htmlFor="staff-count" className="block text-sm font-medium text-neutral-700">
            Personal
          </label>
          <input
            id="staff-count"
            type="number"
            min={0}
            step="1"
            value={staffCountText}
            onChange={(e) => setStaffCountText(e.target.value)}
            className="w-32 rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <p className="text-xs text-neutral-500">
            No existe ninguna razón de densidad de personal para ningún tipo de negocio, así que este es
            el único dato que permite calcular una cifra de personal. Si lo deja vacío, esa cifra
            quedará sin calcular — se lo indicaremos abajo, no se lo ocultaremos.
          </p>
        </fieldset>
      )}

      {state.kind === "done" && <CapacityResultsView estimate={state.estimate} />}

      <div className="mt-auto flex flex-col gap-2">
        {state.kind !== "done" && state.kind !== "gated" && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || state.kind === "submitting"}
            className="rounded bg-blue-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-40"
          >
            {state.kind === "submitting" ? "Calculando..." : "Calcular"}
          </button>
        )}
        <button
          type="button"
          onClick={onContinue}
          disabled={state.kind !== "done"}
          className="rounded bg-blue-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-40"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}

interface CapacityReasons {
  seatsReason: string | null;
  staffReason: string | null;
  dailyCustomersReason: string | null;
}

/**
 * `resultsJson`'s known B-12 shape (`capacity.service.ts`) — read
 * defensively since the wire contract types it as `Record<string,
 * unknown>`, same discipline `OpexEstimateStep.tsx`'s `readResults` applies.
 */
function readReasons(resultsJson: Record<string, unknown>): CapacityReasons {
  return {
    seatsReason: typeof resultsJson.seatsReason === "string" ? resultsJson.seatsReason : null,
    staffReason: typeof resultsJson.staffReason === "string" ? resultsJson.staffReason : null,
    dailyCustomersReason: typeof resultsJson.dailyCustomersReason === "string" ? resultsJson.dailyCustomersReason : null,
  };
}

/**
 * `inputsSnapshot.resolvedRatio` carries the full `ResolvedParameter` (with
 * its citation) that produced the seats band, when one resolved — validated
 * with the real schema rather than ad hoc `typeof` checks, since a
 * malformed citation must never render as if it were real.
 */
function readResolvedRatio(inputsSnapshot: Record<string, unknown>): ResolvedParameter | null {
  const parsed = ResolvedParameterSchema.safeParse(inputsSnapshot.resolvedRatio);
  return parsed.success ? parsed.data : null;
}

interface Band {
  low: number;
  base: number;
  high: number;
}

function readBand(low: number | null, base: number | null, high: number | null): Band | null {
  if (low === null || base === null || high === null) return null;
  return { low, base, high };
}

function CapacityResultsView({ estimate }: { estimate: CapacityEstimate }) {
  const reasons = readReasons(estimate.resultsJson);
  const resolvedRatio = readResolvedRatio(estimate.inputsSnapshot);
  const seatsBand = readBand(estimate.seatsLow, estimate.seatsBase, estimate.seatsHigh);
  const staffBand = readBand(estimate.staffLow, estimate.staffBase, estimate.staffHigh);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-neutral-200 p-4">
        <p className="text-sm font-medium text-neutral-800">Asientos / ocupantes</p>
        {seatsBand !== null ? (
          <>
            <NumericBandDisplay
              label="Asientos estimados"
              band={seatsBand}
              unit="asientos"
              provenance={resolvedRatio?.provenance ?? "referencia_sectorial"}
            />
            {resolvedRatio !== null && <RatioDisclosure ratio={resolvedRatio} />}
          </>
        ) : (
          <p className="mt-1 text-sm text-neutral-600">
            {reasons.seatsReason ?? "No se pudo calcular esta cifra."}
          </p>
        )}
      </div>

      <div className="rounded border border-neutral-200 p-4">
        <p className="text-sm font-medium text-neutral-800">Personal</p>
        {staffBand !== null ? (
          <NumericBandDisplay label="Personal" band={staffBand} unit="personas" provenance="usuario" />
        ) : (
          <p className="mt-1 text-sm text-neutral-600">
            {reasons.staffReason ?? "No se pudo calcular esta cifra."}
          </p>
        )}
      </div>

      <div className="rounded border border-neutral-200 p-4">
        <p className="text-sm font-medium text-neutral-800">Clientes diarios</p>
        <p className="mt-1 text-sm text-neutral-600">
          No calculado — {reasons.dailyCustomersReason ?? "no hay una base citable para este cálculo."}
        </p>
      </div>
    </div>
  );
}

/**
 * The one way this screen renders a non-monetary band — no generic
 * numeric-range component existed in `components/common/` to reuse
 * (`MoneyRangeDisplay` is money-specific), so this stays local rather than
 * introducing shared infrastructure this task did not ask for.
 */
function NumericBandDisplay({
  label,
  band,
  unit,
  provenance,
}: {
  label: string;
  band: Band;
  unit: string;
  provenance: Provenance;
}) {
  return (
    <div>
      <p className="text-lg font-semibold text-neutral-900">
        {band.base} {unit}
      </p>
      <p className="text-xs text-neutral-500">
        {band.low} – {band.high} {unit}
      </p>
      <span className="mt-1 inline-block rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
        {provenance}
      </span>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * "Each ratio used is expandable to show its value, source, and provenance"
 * (UX spec Step 5). A native `<details>` disclosure needs no extra state.
 */
function RatioDisclosure({ ratio }: { ratio: ResolvedParameter }) {
  return (
    <details className="mt-2 text-xs text-neutral-600">
      <summary className="cursor-pointer text-neutral-500">Ver la razón utilizada</summary>
      <div className="mt-2 rounded bg-neutral-50 p-2">
        <p>
          {ratio.valueBase} m² por asiento/ocupante ({ratio.valueLow} – {ratio.valueHigh})
        </p>
        <span className="mt-1 inline-block rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
          {ratio.provenance}
        </span>
        <div className="mt-2">
          <CitationLine citation={ratio.citation} />
        </div>
      </div>
    </details>
  );
}
