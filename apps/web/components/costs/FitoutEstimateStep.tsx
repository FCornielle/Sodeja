"use client";

import { useState } from "react";
import type { Currency, FitoutEstimate } from "@sodeja/schemas";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { formatDate } from "../common/CitationLine";
import { MoneyRangeDisplay } from "../common/MoneyRangeDisplay";

interface Props {
  projectId: string;
  onContinue: () => void;
  onBackToConfirm: () => void;
}

type State =
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "done"; estimate: FitoutEstimate }
  | { kind: "gated" }
  | { kind: "error"; message: string };

/**
 * Step 6a — Costo de habilitación (B-14, Module 9). The base construction
 * cost per m² has NO seeded default anywhere in this system
 * (`FitoutEstimateRequestSchema`'s own doc comment: "no DR commercial
 * fit-out cost basis exists at any confidence level") — so this form asks for
 * it directly, as three required inputs, never pre-filled with a guessed
 * number.
 *
 * `resultsJson` carries no per-zone breakdown (the spec's "broken down by
 * zone" state): `app.fitout_estimate` only ever stores a project-wide total,
 * because the zone split itself is never persisted server-side either
 * (`LayoutZonesStep`'s own doc comment — B-13 added no write path). This
 * screen states that gap rather than fabricating a per-zone split from
 * numbers it does not have.
 */
export function FitoutEstimateStep({ projectId, onContinue, onBackToConfirm }: Props) {
  const [state, setState] = useState<State>({ kind: "form" });
  const [low, setLow] = useState("");
  const [base, setBase] = useState("");
  const [high, setHigh] = useState("");
  const [currency, setCurrency] = useState<Currency>("DOP");

  const parsedLow = Number(low);
  const parsedBase = Number(base);
  const parsedHigh = Number(high);
  const isValid =
    [low, base, high].every((v) => v.trim().length > 0) &&
    [parsedLow, parsedBase, parsedHigh].every((v) => Number.isFinite(v) && v > 0) &&
    parsedLow <= parsedBase &&
    parsedBase <= parsedHigh;

  async function handleSubmit(): Promise<void> {
    if (!isValid) return;
    setState({ kind: "submitting" });
    try {
      const estimate = await apiFetch<FitoutEstimate>(`/projects/${projectId}/fitout-estimate`, {
        method: "POST",
        body: {
          baseCostPerSqmLow: parsedLow,
          baseCostPerSqmBase: parsedBase,
          baseCostPerSqmHigh: parsedHigh,
          currency,
        },
      });
      setState({ kind: "done", estimate });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setState({ kind: "gated" });
        return;
      }
      setState({
        kind: "error",
        message: err instanceof ApiError ? err.message : "No se pudo calcular el costo de habilitación.",
      });
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-neutral-900">Costo de habilitación</h1>
      <p className="text-sm text-neutral-600">
        Estimado a partir de índices de construcción de vivienda, ajustado por tipo de negocio. No
        sustituye una cotización.
      </p>

      {state.kind === "gated" && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>Necesitamos el área confirmada antes de estimar el costo de habilitación.</p>
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
        <fieldset className="flex flex-col gap-3 rounded border border-neutral-200 p-3">
          <legend className="px-1 text-sm font-medium text-neutral-700">
            Costo base de construcción por m² <span className="font-normal text-neutral-500">(indicativo)</span>
          </legend>
          <p className="text-xs text-neutral-500">
            No tenemos una base de costos de acondicionamiento comercial verificada para RD. Ingrese su
            propio estimado (por ejemplo, de una cotización).
          </p>
          <div className="grid grid-cols-3 gap-2">
            <MoneyInput label="Bajo" value={low} onChange={setLow} />
            <MoneyInput label="Base" value={base} onChange={setBase} />
            <MoneyInput label="Alto" value={high} onChange={setHigh} />
          </div>
          <div>
            <label htmlFor="fitout-currency" className="block text-xs text-neutral-600">
              Moneda
            </label>
            <select
              id="fitout-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="mt-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="DOP">DOP</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </fieldset>
      )}

      {state.kind === "done" && (
        <div className="rounded border border-neutral-200 p-4">
          <MoneyRangeDisplay
            label="Total de habilitación"
            low={state.estimate.totalLowAmount}
            base={state.estimate.totalBaseAmount}
            high={state.estimate.totalHighAmount}
            currency={state.estimate.currency}
            provenance="usuario"
          />
          <p className="mt-2 text-xs text-neutral-500">
            Índice de construcción (ICDV) con fecha base {formatDate(state.estimate.indexBaseDate)}.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            No se muestra un desglose por zona: el reparto de zonas que usted definió en el paso
            anterior no se guarda en el sistema, así que este total es del local completo.
          </p>
        </div>
      )}

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
