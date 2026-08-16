"use client";

import { useState } from "react";
import type { CompanySize, OpexEstimate } from "@sodeja/schemas";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { MoneyRangeDisplay } from "../common/MoneyRangeDisplay";

interface Props {
  projectId: string;
  onContinue: () => void;
  onBackToConfirm: () => void;
}

type State =
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "done"; estimate: OpexEstimate }
  | { kind: "gated" }
  | { kind: "error"; message: string };

const COMPANY_SIZE_LABEL: Record<CompanySize, string> = {
  micro: "Microempresa",
  pequena: "Pequeña empresa",
  mediana: "Mediana empresa",
  grande: "Gran empresa",
};

/**
 * `resultsJson`'s known B-15 shape (`opex.service.ts`) — read defensively
 * since the wire contract types it as `Record<string, unknown>`. Only the
 * fields this screen surfaces per the spec/task are declared.
 */
interface OpexResults {
  restaurantWageCaveat: string | null;
  employerAfpNote: string;
  payrollUnavailableReason: string | null;
  partial: boolean;
}

function readResults(resultsJson: Record<string, unknown>): OpexResults {
  return {
    restaurantWageCaveat: typeof resultsJson.restaurantWageCaveat === "string" ? resultsJson.restaurantWageCaveat : null,
    employerAfpNote: typeof resultsJson.employerAfpNote === "string" ? resultsJson.employerAfpNote : "",
    payrollUnavailableReason:
      typeof resultsJson.payrollUnavailableReason === "string" ? resultsJson.payrollUnavailableReason : null,
    partial: resultsJson.partial === true,
  };
}

/**
 * Step 6b — Costos operativos mensuales (B-15, Module 10). `companySize` is
 * required and explicit (`OpexEstimateRequestSchema`'s doc comment: the
 * Ley 488-08 dual-criteria legal determination cannot be evaluated without a
 * financial projection, so it is never guessed). Rent is, per the spec, "the
 * item users most often know better than SODEJA does" — kept as its own
 * prominently editable, optional field, same for utilities.
 *
 * `staffCount` is offered here as a fallback per the task's guidance
 * (`costs.controller.test.ts` shows it can substitute for a capacity
 * estimate on the request itself) — this app builds no capacity-estimate
 * screen (Step 5's capacity half, Module 6, is out of scope for this
 * change), so without this field a project with no capacity estimate could
 * never produce a payroll line at all.
 */
export function OpexEstimateStep({ projectId, onContinue, onBackToConfirm }: Props) {
  const [state, setState] = useState<State>({ kind: "form" });
  const [companySize, setCompanySize] = useState<CompanySize | "">("");
  const [staffCountText, setStaffCountText] = useState("");
  const [rentText, setRentText] = useState("");
  const [utilitiesText, setUtilitiesText] = useState("");

  const staffCount = staffCountText.trim().length > 0 ? Number(staffCountText) : undefined;
  const monthlyRentDop = rentText.trim().length > 0 ? Number(rentText) : undefined;
  const monthlyUtilitiesDop = utilitiesText.trim().length > 0 ? Number(utilitiesText) : undefined;
  const numbersValid =
    (staffCount === undefined || (Number.isInteger(staffCount) && staffCount >= 0)) &&
    (monthlyRentDop === undefined || (Number.isFinite(monthlyRentDop) && monthlyRentDop >= 0)) &&
    (monthlyUtilitiesDop === undefined || (Number.isFinite(monthlyUtilitiesDop) && monthlyUtilitiesDop >= 0));
  const isValid = companySize !== "" && numbersValid;

  async function handleSubmit(): Promise<void> {
    if (!isValid) return;
    setState({ kind: "submitting" });
    try {
      const estimate = await apiFetch<OpexEstimate>(`/projects/${projectId}/opex-estimate`, {
        method: "POST",
        body: { companySize, staffCount, monthlyRentDop, monthlyUtilitiesDop },
      });
      setState({ kind: "done", estimate });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setState({ kind: "gated" });
        return;
      }
      setState({
        kind: "error",
        message: err instanceof ApiError ? err.message : "No se pudo calcular los costos operativos.",
      });
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-neutral-900">Costos operativos mensuales</h1>

      {state.kind === "gated" && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>Necesitamos el área confirmada antes de estimar los costos operativos.</p>
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
          <div>
            <label htmlFor="company-size" className="block text-sm font-medium text-neutral-700">
              Tamaño de empresa
            </label>
            <select
              id="company-size"
              value={companySize}
              onChange={(e) => setCompanySize(e.target.value as CompanySize)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="">Seleccione...</option>
              {(Object.keys(COMPANY_SIZE_LABEL) as CompanySize[]).map((size) => (
                <option key={size} value={size}>
                  {COMPANY_SIZE_LABEL[size]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-neutral-500">
              Determina la tabla de salario mínimo aplicada. El sistema no puede calcularlo por usted:
              la clasificación legal (Ley 488-08) requiere ventas anuales, que aún no se han proyectado.
            </p>
          </div>

          <div>
            <label htmlFor="staff-count" className="block text-sm font-medium text-neutral-700">
              Personal (si no hay una estimación de capacidad guardada)
            </label>
            <input
              id="staff-count"
              type="number"
              min={0}
              value={staffCountText}
              onChange={(e) => setStaffCountText(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="rent" className="block text-sm font-medium text-neutral-700">
              Alquiler mensual (DOP) — opcional
            </label>
            <input
              id="rent"
              type="number"
              min={0}
              value={rentText}
              onChange={(e) => setRentText(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Usted probablemente conoce este número mejor que nosotros — edítelo aquí.
            </p>
          </div>

          <div>
            <label htmlFor="utilities" className="block text-sm font-medium text-neutral-700">
              Servicios mensuales (DOP) — opcional
            </label>
            <input
              id="utilities"
              type="number"
              min={0}
              value={utilitiesText}
              onChange={(e) => setUtilitiesText(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-neutral-500">Incluya el costo de planta eléctrica/inversor si aplica.</p>
          </div>
        </fieldset>
      )}

      {state.kind === "done" && <OpexResultsView estimate={state.estimate} />}

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

function OpexResultsView({ estimate }: { estimate: OpexEstimate }) {
  const results = readResults(estimate.resultsJson);
  return (
    <div className="rounded border border-neutral-200 p-4">
      <MoneyRangeDisplay
        label="Total operativo mensual"
        low={estimate.monthlyLowAmount}
        base={estimate.monthlyBaseAmount}
        high={estimate.monthlyHighAmount}
        currency={estimate.currency}
        provenance="referencia_sectorial"
      />

      {results.partial && (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          Este total es parcial: falta nómina, alquiler o servicios.
        </p>
      )}
      {results.payrollUnavailableReason !== null && (
        <p className="mt-2 text-xs text-neutral-600">{results.payrollUnavailableReason}</p>
      )}
      {results.restaurantWageCaveat !== null && (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          {results.restaurantWageCaveat}
        </p>
      )}
      {results.employerAfpNote.length > 0 && (
        <p className="mt-2 text-xs text-neutral-500">{results.employerAfpNote}</p>
      )}
    </div>
  );
}
