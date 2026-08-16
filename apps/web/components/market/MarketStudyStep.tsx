"use client";

import { useState } from "react";
import type { MarketStudy } from "@sodeja/schemas";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { formatDate } from "../common/CitationLine";

interface Props {
  projectId: string;
  onContinue: () => void;
  onBackToConfirm: () => void;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; study: MarketStudy }
  | { kind: "gated"; reason: "area" | "business-type" }
  | { kind: "error"; message: string };

const DEFAULT_RADIUS_M = 500;
const MAX_RADIUS_M = 5000;

/**
 * Step 3 — Entorno del mercado (B-9, Module 1). Runs after `LayoutZonesStep`
 * in this flow's actual sequence — see `ProjectFlow.tsx`'s doc comment for
 * why the numbered order here differs from the spec's: business type is now
 * fixed at project creation (Step 4, run first — see
 * `components/business-type/BusinessTypeStep.tsx`), so this step's only real
 * prerequisite, the B-7a confirmed-area gate, is already satisfied by the
 * time a user reaches it; the `gated`/`business-type` state below exists only
 * as defensive handling of the API's own documented 409, not because it is
 * expected to fire in this flow's order.
 *
 * Confidence-tier display rules are enforced HERE, not by the API —
 * `MarketStudySchema`'s own doc comment: "Suppressing the figure when
 * confidence === 'insuficiente' ... this endpoint does not null anything out
 * itself." `ConfidenceSection` below is the one place those four states are
 * decided.
 */
export function MarketStudyStep({ projectId, onContinue, onBackToConfirm }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [radiusText, setRadiusText] = useState(String(DEFAULT_RADIUS_M));

  const parsedRadius = Number(radiusText);
  const isValidRadius =
    radiusText.trim().length > 0 && Number.isFinite(parsedRadius) && parsedRadius > 0 && parsedRadius <= MAX_RADIUS_M;

  async function compute(): Promise<void> {
    if (!isValidRadius) return;
    setState({ kind: "loading" });
    try {
      const study = await apiFetch<MarketStudy>(
        `/projects/${projectId}/market-study?radiusM=${Math.round(parsedRadius)}`,
        { method: "POST" },
      );
      setState({ kind: "loaded", study });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setState({ kind: "gated", reason: err.message.includes("business type") ? "business-type" : "area" });
        return;
      }
      setState({
        kind: "error",
        message: err instanceof ApiError ? err.message : "No pudimos calcular el entorno de mercado de este sitio.",
      });
    }
  }

  async function addManualCompetitors(delta: number): Promise<void> {
    if (state.kind !== "loaded") return;
    try {
      const study = await apiFetch<MarketStudy>(`/projects/${projectId}/market-study/manual-competitors`, {
        method: "PATCH",
        body: { delta },
      });
      setState({ kind: "loaded", study });
    } catch {
      // Non-fatal: the manual-competitors panel just keeps showing the previous count.
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-neutral-900">Población y competencia</h1>

      <div className="rounded border border-neutral-200 p-3">
        <label htmlFor="radius" className="block text-sm font-medium text-neutral-700">
          Radio de análisis (m)
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="radius"
            type="number"
            min={1}
            max={MAX_RADIUS_M}
            step="50"
            value={radiusText}
            onChange={(e) => setRadiusText(e.target.value)}
            className="w-32 rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={compute}
            disabled={!isValidRadius || state.kind === "loading"}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {state.kind === "loaded" ? "Recalcular" : "Calcular"}
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-500">Por defecto 500 m. Máximo {MAX_RADIUS_M} m.</p>
      </div>

      {state.kind === "loading" && (
        <div className="animate-pulse space-y-2" role="status" aria-label="Calculando">
          <div className="h-16 w-full rounded bg-neutral-200" />
          <div className="h-16 w-full rounded bg-neutral-200" />
        </div>
      )}

      {state.kind === "gated" && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            {state.reason === "area"
              ? "Necesitamos el área confirmada antes de calcular el entorno de mercado."
              : "Este proyecto no tiene un tipo de negocio asignado, así que no podemos calcular la competencia."}
          </p>
          {state.reason === "area" && (
            <button type="button" onClick={onBackToConfirm} className="mt-2 font-medium text-blue-600 underline">
              Volver a confirmar el área
            </button>
          )}
        </div>
      )}

      {state.kind === "error" && (
        <div className="text-sm text-neutral-700" role="alert">
          <p>{state.message}</p>
          <button type="button" onClick={compute} className="mt-2 font-medium text-blue-600 underline">
            Reintentar
          </button>
        </div>
      )}

      {state.kind === "loaded" && <ConfidenceSection study={state.study} />}
      {state.kind === "loaded" && <ManualCompetitors study={state.study} onAdd={addManualCompetitors} />}

      <div className="mt-auto flex flex-col gap-2">
        <button
          type="button"
          onClick={onContinue}
          disabled={state.kind !== "loaded"}
          className="rounded bg-blue-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-40"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}

function ConfidenceSection({ study }: { study: MarketStudy }) {
  if (study.confidence === "insuficiente") {
    return (
      <div className="rounded border border-neutral-300 p-4">
        <p className="text-sm text-neutral-900">
          No tenemos suficiente información de esta zona para mostrar cifras de población o competencia.
        </p>
        <p className="mt-2 text-sm text-neutral-600">
          Mostrar un número aquí, aunque fuera pequeño, podría hacerle pensar que hay poca competencia
          cuando en realidad es que no tenemos datos de esta zona. Puede agregar negocios que usted
          conozca abajo — esos sí se cuentan.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded border border-neutral-200 p-4">
      {study.confidence === "baja" && (
        <p
          className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900"
          role="alert"
        >
          Tenemos poca información de esta zona. Estos números pueden subestimar la competencia real.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-neutral-500">Población estimada</dt>
          <dd className="text-lg font-semibold text-neutral-900">{study.populationEst.toLocaleString("es-DO")}</dd>
          <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">referencia_sectorial</span>
        </div>
        <div>
          <dt className="text-neutral-500">Competidores (dataset)</dt>
          <dd className="text-lg font-semibold text-neutral-900">{study.competitorCount}</dd>
          <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">referencia_sectorial</span>
        </div>
      </dl>

      {study.demandIndexBase !== null && study.demandIndexLow !== null && study.demandIndexHigh !== null && (
        <div className="mt-3">
          <p className="text-sm text-neutral-500">Índice de demanda (población por competidor)</p>
          <p className="text-lg font-semibold text-neutral-900">{study.demandIndexBase.toFixed(1)}</p>
          <p className="text-xs text-neutral-500">
            {study.demandIndexLow.toFixed(1)} – {study.demandIndexHigh.toFixed(1)}
          </p>
          <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">estimado</span>
        </div>
      )}

      <p className="mt-3 text-xs text-neutral-500">
        Censo {study.censusYear}
        {study.poiVintage !== null && <> · lugares consultados: {formatDate(study.poiVintage)}</>}
      </p>
    </div>
  );
}

/**
 * Always present, regardless of confidence tier (UX spec Step 3: "Agregar un
 * negocio que usted conoce" — manual competitor entry is a first-class
 * action, because informal businesses appear in no dataset).
 */
function ManualCompetitors({ study, onAdd }: { study: MarketStudy; onAdd: (delta: number) => void }) {
  const [deltaText, setDeltaText] = useState("1");
  const delta = Number(deltaText);
  const isValid = deltaText.trim().length > 0 && Number.isInteger(delta) && delta > 0;

  return (
    <div className="rounded border border-blue-200 bg-blue-50 p-3">
      <p className="text-sm font-medium text-blue-900">Agregar un negocio que usted conoce</p>
      <p className="mt-1 text-xs text-blue-800">
        Agregados hasta ahora: <span className="font-semibold">{study.competitorsUserAdded}</span>
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          min={1}
          value={deltaText}
          onChange={(e) => setDeltaText(e.target.value)}
          className="w-20 rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={!isValid}
          onClick={() => onAdd(delta)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Agregar
        </button>
        <button
          type="button"
          disabled={!isValid || study.competitorsUserAdded < delta}
          onClick={() => onAdd(-delta)}
          className="rounded border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-600 disabled:opacity-40"
        >
          Quitar
        </button>
      </div>
    </div>
  );
}
