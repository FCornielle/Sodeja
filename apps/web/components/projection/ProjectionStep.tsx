"use client";

import { useState } from "react";
import type { FinancialProjection } from "@sodeja/schemas";
import { apiFetch, ApiError } from "../../lib/apiClient";

interface Props {
  projectId: string;
  onContinue: () => void;
  onNavigateToConfirm: () => void;
  onNavigateToFitout: () => void;
  onNavigateToOpex: () => void;
  onNavigateToCapacity: () => void;
}

interface MissingBody {
  message: string;
  missing: string[];
}

type State =
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "done"; projection: FinancialProjection }
  | { kind: "blocked"; missing: string[] }
  | { kind: "error"; message: string };

const DEFAULT_HORIZON_MONTHS = 36;
const MAX_HORIZON_MONTHS = 60;

function isMissingBody(body: unknown): body is MissingBody {
  return (
    typeof body === "object" &&
    body !== null &&
    "missing" in body &&
    Array.isArray((body as { missing: unknown }).missing)
  );
}

/**
 * Step 7 — Proyección financiera (B-17, Module 7), the integration point.
 * Monthly revenue is the one genuinely new, required input — no benchmark
 * exists (`FinancialProjectionRequestSchema`'s doc comment) — so it is never
 * pre-filled.
 *
 * The prerequisites-missing `409` is rendered as a real checklist
 * (`BlockedChecklist` below), per the spec: "each deep-linking back to its
 * step." All four entries — `confirmed_area`, `fitout_estimate`,
 * `opex_estimate`, `capacity_estimate` — now deep-link to a real screen:
 * `capacity_estimate` used to fall back to a minimal inline "unblock" action
 * here (this app had no capacity screen at all), but that shortcut is gone
 * now that `CapacityEstimateStep.tsx` exists and sits earlier in
 * `ProjectFlow.tsx`'s sequence (right after `layout`, well before this
 * step) — a project reaching this screen the normal way already has a
 * capacity estimate, so this entry is expected to be the rare case, not the
 * default path it used to be.
 */
export function ProjectionStep({
  projectId,
  onContinue,
  onNavigateToConfirm,
  onNavigateToFitout,
  onNavigateToOpex,
  onNavigateToCapacity,
}: Props) {
  const [state, setState] = useState<State>({ kind: "form" });
  const [low, setLow] = useState("");
  const [base, setBase] = useState("");
  const [high, setHigh] = useState("");
  const [horizonText, setHorizonText] = useState(String(DEFAULT_HORIZON_MONTHS));

  const parsedLow = Number(low);
  const parsedBase = Number(base);
  const parsedHigh = Number(high);
  const parsedHorizon = Number(horizonText);
  const isValid =
    [low, base, high].every((v) => v.trim().length > 0) &&
    [parsedLow, parsedBase, parsedHigh].every((v) => Number.isFinite(v) && v >= 0) &&
    parsedLow <= parsedBase &&
    parsedBase <= parsedHigh &&
    Number.isInteger(parsedHorizon) &&
    parsedHorizon > 0 &&
    parsedHorizon <= MAX_HORIZON_MONTHS;

  async function handleSubmit(): Promise<void> {
    if (!isValid) return;
    setState({ kind: "submitting" });
    try {
      const projection = await apiFetch<FinancialProjection>(`/projects/${projectId}/financial-projection`, {
        method: "POST",
        body: {
          monthlyRevenueLow: parsedLow,
          monthlyRevenueBase: parsedBase,
          monthlyRevenueHigh: parsedHigh,
          horizonMonths: parsedHorizon,
        },
      });
      setState({ kind: "done", projection });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && isMissingBody(err.body)) {
        setState({ kind: "blocked", missing: err.body.missing });
        return;
      }
      setState({
        kind: "error",
        message: err instanceof ApiError ? err.message : "No se pudo calcular la proyección financiera.",
      });
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-neutral-900">Proyección financiera</h1>

      {state.kind === "blocked" && (
        <BlockedChecklist
          missing={state.missing}
          onNavigateToConfirm={onNavigateToConfirm}
          onNavigateToFitout={onNavigateToFitout}
          onNavigateToOpex={onNavigateToOpex}
          onNavigateToCapacity={onNavigateToCapacity}
          onRetry={handleSubmit}
        />
      )}

      {state.kind === "error" && (
        <p className="text-sm text-red-600" role="alert">
          {state.message}
        </p>
      )}

      {state.kind !== "done" && (
        <fieldset className="flex flex-col gap-3 rounded border border-neutral-200 p-3">
          <legend className="px-1 text-sm font-medium text-neutral-700">Ingreso mensual estimado</legend>
          <p className="text-xs text-neutral-500">
            No existe un benchmark de ingresos para micronegocios en RD. Ingrese su propio estimado.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <MoneyInput label="Bajo" value={low} onChange={setLow} />
            <MoneyInput label="Base" value={base} onChange={setBase} />
            <MoneyInput label="Alto" value={high} onChange={setHigh} />
          </div>
          <div>
            <label htmlFor="horizon" className="block text-xs text-neutral-600">
              Horizonte (meses)
            </label>
            <input
              id="horizon"
              type="number"
              min={1}
              max={MAX_HORIZON_MONTHS}
              value={horizonText}
              onChange={(e) => setHorizonText(e.target.value)}
              className="mt-1 w-24 rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </div>
        </fieldset>
      )}

      {state.kind === "done" && <ProjectionResults projection={state.projection} />}

      <div className="mt-auto flex flex-col gap-2">
        {state.kind !== "done" && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || state.kind === "submitting"}
            className="rounded bg-blue-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-40"
          >
            {state.kind === "submitting" ? "Calculando..." : "Calcular proyección"}
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

function MoneyInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-neutral-600">{label}</label>
      <input
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
      />
    </div>
  );
}

function BlockedChecklist({
  missing,
  onNavigateToConfirm,
  onNavigateToFitout,
  onNavigateToOpex,
  onNavigateToCapacity,
  onRetry,
}: {
  missing: string[];
  onNavigateToConfirm: () => void;
  onNavigateToFitout: () => void;
  onNavigateToOpex: () => void;
  onNavigateToCapacity: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">Faltan datos antes de poder calcular la proyección:</p>
      <ul className="mt-2 flex flex-col gap-2">
        {missing.map((item) => (
          <li key={item} className="rounded border border-amber-300 bg-white p-2">
            <p className="text-xs text-neutral-700">{item}</p>
            {item.includes("confirmed_area") && (
              <button type="button" onClick={onNavigateToConfirm} className="mt-1 font-medium text-blue-600 underline">
                Ir a confirmar el área
              </button>
            )}
            {item.includes("fitout_estimate") && (
              <button type="button" onClick={onNavigateToFitout} className="mt-1 font-medium text-blue-600 underline">
                Ir a costo de habilitación
              </button>
            )}
            {item.includes("opex_estimate") && (
              <button type="button" onClick={onNavigateToOpex} className="mt-1 font-medium text-blue-600 underline">
                Ir a costos operativos
              </button>
            )}
            {item.includes("capacity_estimate") && (
              <button type="button" onClick={onNavigateToCapacity} className="mt-1 font-medium text-blue-600 underline">
                Ir a capacidad estimada
              </button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onRetry} className="mt-3 font-medium text-blue-600 underline">
        Reintentar ahora
      </button>
    </div>
  );
}

interface SensitivityLine {
  assumptionKey: string;
  labelEs: string;
  breakevenMonthShift: number | null;
  terminalCashDeltaAmount: number;
  rank: number;
}

function readSensitivity(resultsJson: Record<string, unknown>): SensitivityLine[] {
  const raw = resultsJson.sensitivity;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (l): l is SensitivityLine =>
      typeof l === "object" &&
      l !== null &&
      typeof (l as SensitivityLine).labelEs === "string" &&
      typeof (l as SensitivityLine).rank === "number",
  );
}

function ProjectionResults({ projection }: { projection: FinancialProjection }) {
  const sensitivity = readSensitivity(projection.resultsJson);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-neutral-200 p-4">
        <p className="text-sm text-neutral-500">Punto de equilibrio (meses)</p>
        <BreakevenDisplay low={projection.breakevenMonthLow} base={projection.breakevenMonthBase} high={projection.breakevenMonthHigh} />
      </div>

      <div className="rounded border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-900">Lo que más mueve su resultado</p>
        {sensitivity.length === 0 ? (
          <p className="mt-1 text-xs text-blue-800">No se pudo calcular la sensibilidad para este escenario.</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-2">
            {[...sensitivity]
              .sort((a, b) => a.rank - b.rank)
              .map((line) => (
                <li key={line.assumptionKey} className="text-sm text-blue-900">
                  {line.rank}. {line.labelEs} —{" "}
                  {line.breakevenMonthShift !== null
                    ? `desplaza el punto de equilibrio ${line.breakevenMonthShift} ${line.breakevenMonthShift === 1 ? "mes" : "meses"}`
                    : `cambia el efectivo acumulado final en ${line.terminalCashDeltaAmount.toLocaleString("es-DO", { maximumFractionDigits: 0 })} ${projection.currency}`}
                </li>
              ))}
          </ol>
        )}
      </div>

      <p className="rounded border border-neutral-300 bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-600">
        {typeof projection.resultsJson.disclaimer === "string" ? projection.resultsJson.disclaimer : ""}
      </p>
    </div>
  );
}

/**
 * `null` on any bound MUST render as "No alcanza el punto de equilibrio en
 * el horizonte proyectado" — never 0, never blank (the single most important
 * display rule on this screen per the task brief).
 */
function BreakevenDisplay({ low, base, high }: { low: number | null; base: number | null; high: number | null }) {
  if (low === null && base === null && high === null) {
    return <p className="text-base font-semibold text-neutral-900">No alcanza el punto de equilibrio en el horizonte proyectado.</p>;
  }
  return (
    <div>
      <p className="text-lg font-semibold text-neutral-900">
        {base !== null ? `${base} ${base === 1 ? "mes" : "meses"}` : "No alcanza el punto de equilibrio en el horizonte proyectado"}
      </p>
      <p className="text-xs text-neutral-500">
        {low !== null ? `${low}` : "no alcanza"} – {high !== null ? `${high}` : "no alcanza"} meses
      </p>
    </div>
  );
}
