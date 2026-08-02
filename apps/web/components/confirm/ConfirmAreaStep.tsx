"use client";

import { useState } from "react";
import type { ProjectLocation } from "@sodeja/schemas";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { isAreaImplausible } from "../../lib/geometry";
import type { LocationDraft } from "../../lib/types";

interface Props {
  projectId: string;
  draft: LocationDraft;
  onBack: () => void;
  onConfirmed: (location: ProjectLocation) => void;
}

/**
 * Step 2 — Confirmacion del area (specs/ux/flows.md, "the hard gate"):
 * nothing downstream may be computed until this passes. Disclaimer copy and
 * the primary action label are VERBATIM from the spec.
 *
 * KNOWN B-7a CONTRACT GAP (documented, not silently papered over): the spec's
 * state table says an unchanged dataset suggestion should be "Recorded as
 * `footprint_dataset` + confirmed." But `PUT /projects/:id/location`
 * (apps/api/src/projects/projects.service.ts's `confirmLocation`, B-7a) ALWAYS
 * persists `area_source = 'user_entered'` server-side, regardless of what this
 * client sends — B-7a's endpoint, as built, has no other code path. This
 * component still computes and displays the spec-intended provenance chip
 * client-side (`footprint_dataset` vs `usuario`) since that distinction IS
 * determinable here, but the value actually stored in Postgres is uniformly
 * `user_entered` until B-7a's write path is extended. See this task's final
 * report for the full note.
 *
 * The optional "floors" / "usable vs total area" inputs the spec calls for
 * are captured in this form but NOT sent to the API — `ConfirmProjectLocation
 * RequestSchema` (@sodeja/schemas project.ts) has no columns for them. Also a
 * documented gap, not a silent drop: a caption next to those fields says so.
 */
export function ConfirmAreaStep({ projectId, draft, onBack, onConfirmed }: Props) {
  const [areaText, setAreaText] = useState(String(draft.areaSqm));
  const [floors, setFloors] = useState("");
  const [usableAreaText, setUsableAreaText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedArea = Number(areaText);
  const isValidArea = areaText.trim().length > 0 && Number.isFinite(parsedArea) && parsedArea > 0;
  const implausible = isValidArea && isAreaImplausible(parsedArea);

  const unchangedFromDataset =
    draft.areaSource === "footprint_dataset" &&
    draft.datasetSuggestedAreaSqm !== undefined &&
    isValidArea &&
    parsedArea === draft.datasetSuggestedAreaSqm;

  // Spec-intended provenance for DISPLAY only — see the doc comment above.
  const displayProvenance = unchangedFromDataset ? "estimado" : "usuario";
  const displayAreaSource = unchangedFromDataset ? "footprint_dataset" : "user_entered";

  let disabledReason: string | null = null;
  if (!isValidArea) disabledReason = "Ingrese un área mayor que cero.";
  else if (submitting) disabledReason = "Guardando...";

  async function handleConfirm(): Promise<void> {
    if (disabledReason) return;
    setSubmitting(true);
    setError(null);
    try {
      const location = await apiFetch<ProjectLocation>(`/projects/${projectId}/location`, {
        method: "PUT",
        body: {
          areaSqm: parsedArea,
          centroidLon: draft.centroidLon,
          centroidLat: draft.centroidLat,
        },
      });
      onConfirmed(location);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el área. Intente de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto p-6">
      <button type="button" onClick={onBack} className="self-start text-sm text-blue-600">
        &larr; Volver al mapa
      </button>

      <h1 className="text-xl font-semibold text-neutral-900">Confirmar área</h1>

      <div>
        <label htmlFor="confirm-area" className="block text-sm font-medium text-neutral-700">
          Área (m²)
        </label>
        <input
          id="confirm-area"
          type="number"
          min={0}
          step="0.1"
          value={areaText}
          onChange={(e) => setAreaText(e.target.value)}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-3 text-2xl font-semibold"
        />
        <div className="mt-1 flex gap-2 text-xs text-neutral-500">
          <span className="rounded bg-neutral-100 px-2 py-0.5">{displayProvenance}</span>
          <span>fuente: {displayAreaSource}</span>
        </div>
      </div>

      <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Esta área es aproximada y proviene de imágenes satelitales. Puede tener un margen de error
        importante. Verifíquela o corríjala antes de continuar.
      </p>

      {implausible && (
        <p className="text-sm text-amber-700" role="alert">
          Esta área es inusual ({parsedArea.toFixed(0)} m²). ¿Es correcto? (Umbral heurístico de
          5-5,000 m², no específico por tipo de negocio — el tipo de negocio aún no se ha
          seleccionado en este punto del flujo.)
        </p>
      )}

      <fieldset className="rounded border border-neutral-200 p-3">
        <legend className="px-1 text-sm font-medium text-neutral-700">Datos opcionales</legend>
        <p className="mb-2 text-xs text-neutral-500">
          Estos valores se capturan aquí pero aún no se envían ni se guardan en el sistema — el
          contrato actual de <code>PUT /projects/:id/location</code> no tiene columnas para ellos.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="confirm-floors" className="block text-xs text-neutral-600">
              Pisos
            </label>
            <input
              id="confirm-floors"
              type="number"
              min={0}
              value={floors}
              onChange={(e) => setFloors(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="confirm-usable" className="block text-xs text-neutral-600">
              Área útil (m²)
            </label>
            <input
              id="confirm-usable"
              type="number"
              min={0}
              value={usableAreaText}
              onChange={(e) => setUsableAreaText(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </fieldset>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-1">
        {disabledReason && <p className="text-xs text-neutral-500">{disabledReason}</p>}
        <button
          type="button"
          onClick={handleConfirm}
          disabled={Boolean(disabledReason)}
          className="rounded bg-blue-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-40"
        >
          Confirmo esta área
        </button>
      </div>
    </div>
  );
}
