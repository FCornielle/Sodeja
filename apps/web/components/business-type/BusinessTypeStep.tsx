"use client";

import { useEffect, useState } from "react";
import type { BusinessTypeCatalogEntry, Jurisdiction, Project } from "@sodeja/schemas";
import { apiFetch, ApiError } from "../../lib/apiClient";

interface Props {
  onCreated: (project: Project) => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; businessTypes: BusinessTypeCatalogEntry[]; jurisdictions: Jurisdiction[] }
  | { kind: "error"; message: string };

/**
 * Step 4 — Tipo de negocio (Module 5), REAL screen, replacing
 * `app/page.tsx`'s former dev-only bootstrap. Also carries the one question
 * the UX spec has no dedicated screen for: which of the 3 launch metro areas
 * (jurisdiction) the project is in.
 *
 * ORDERING DEVIATION FROM THE SPEC, documented once here rather than
 * re-litigated at every call site: the spec's Step 4 comes AFTER Step 1's
 * map (business type is meant to follow site selection). This backend can't
 * support that — `POST /projects` (B-11a) requires `businessTypeId` AND
 * `jurisdictionId` at CREATION time, and there is no endpoint to attach
 * either to a project after the fact. So this screen runs FIRST, before any
 * map interaction, and jurisdiction stands in for what the spec expects to
 * derive from the pin the user eventually drops on the map. This is a
 * backend constraint, not a UX preference — restructuring `POST /projects`
 * to accept a business type/jurisdiction update after creation is out of
 * scope for this change.
 *
 * Jurisdiction = the 3 seeded launch metro areas (Distrito Nacional / Santo
 * Domingo / Santiago), per docs/SODEJA_MASTER_PLAN.md's "ship narrow"
 * framing — these ARE the jurisdiction choice, not a free-form question. No
 * UX-spec copy exists for this control, so the copy below is this change's
 * own, kept deliberately plain.
 */
export function BusinessTypeStep({ onCreated }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selectedBusinessTypeId, setSelectedBusinessTypeId] = useState<number | null>(null);
  const [selectedJurisdictionId, setSelectedJurisdictionId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [missingTypeText, setMissingTypeText] = useState("");
  const [missingTypeSent, setMissingTypeSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<BusinessTypeCatalogEntry[]>("/business-types", { signal: controller.signal }),
      apiFetch<Jurisdiction[]>("/jurisdictions", { signal: controller.signal }),
    ])
      .then(([businessTypes, jurisdictions]) => setState({ kind: "loaded", businessTypes, jurisdictions }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message: err instanceof ApiError ? err.message : "No pudimos cargar los tipos de negocio.",
        });
      });
    return () => controller.abort();
  }, []);

  const canSubmit =
    selectedBusinessTypeId !== null && selectedJurisdictionId !== null && name.trim().length > 0 && !submitting;

  async function handleCreate(): Promise<void> {
    if (!canSubmit || selectedBusinessTypeId === null || selectedJurisdictionId === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const project = await apiFetch<Project>("/projects", {
        method: "POST",
        body: { name: name.trim(), businessTypeId: selectedBusinessTypeId, jurisdictionId: selectedJurisdictionId },
      });
      onCreated(project);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "No se pudo crear el proyecto.");
    } finally {
      setSubmitting(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="animate-pulse space-y-3" role="status" aria-label="Cargando">
          <div className="h-6 w-1/2 rounded bg-neutral-200" />
          <div className="h-24 w-full rounded bg-neutral-200" />
          <div className="h-24 w-full rounded bg-neutral-200" />
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="mx-auto max-w-2xl p-6 text-sm text-neutral-700" role="alert">
        <p>{state.message}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Seleccionar tipo de negocio</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Vamos a partir de valores de referencia del sector. Usted podrá ajustarlos todos.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {state.businessTypes.map((bt) => (
          <button
            key={bt.id}
            type="button"
            onClick={() => setSelectedBusinessTypeId(bt.id)}
            aria-pressed={selectedBusinessTypeId === bt.id}
            className={`rounded border p-3 text-left ${
              selectedBusinessTypeId === bt.id
                ? "border-blue-600 bg-blue-50"
                : "border-neutral-200 hover:border-neutral-300"
            }`}
          >
            <p className="text-sm font-semibold text-neutral-900">{bt.nameEs}</p>
            {bt.descriptionEs !== null && <p className="mt-1 text-xs text-neutral-600">{bt.descriptionEs}</p>}
          </button>
        ))}
      </div>

      <MissingTypeCapture
        value={missingTypeText}
        onChange={setMissingTypeText}
        sent={missingTypeSent}
        onSend={() => setMissingTypeSent(true)}
      />

      <div>
        <h2 className="text-sm font-semibold text-neutral-800">Municipio / área metropolitana</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Por ahora cubrimos solo estas tres zonas de lanzamiento.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {state.jurisdictions.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => setSelectedJurisdictionId(j.id)}
              aria-pressed={selectedJurisdictionId === j.id}
              className={`rounded-full border px-4 py-2 text-sm ${
                selectedJurisdictionId === j.id
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-neutral-300 text-neutral-700"
              }`}
            >
              {j.nameEs}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="project-name" className="block text-sm font-medium text-neutral-700">
          Nombre del proyecto
        </label>
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. Mi restaurante en Piantini"
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      {submitError && (
        <p className="text-sm text-red-600" role="alert">
          {submitError}
        </p>
      )}

      <button
        type="button"
        onClick={handleCreate}
        disabled={!canSubmit}
        className="rounded bg-blue-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-40"
      >
        {submitting ? "Creando..." : "Continuar"}
      </button>
    </div>
  );
}

/**
 * The spec's fallback capture field: "No encontramos su tipo de negocio",
 * doubling as sector-demand research. No endpoint exists to receive this —
 * there is no backlog item covering it — so this is honestly a client-side
 * no-op: it acknowledges what was typed and does not send it anywhere.
 * Documented here rather than silently dropped, same discipline
 * `PoiLabelStep` uses for its unsaved confirm/override answer.
 */
function MissingTypeCapture({
  value,
  onChange,
  sent,
  onSend,
}: {
  value: string;
  onChange: (v: string) => void;
  sent: boolean;
  onSend: () => void;
}) {
  return (
    <div className="rounded border border-neutral-200 p-3">
      <p className="text-sm text-neutral-800">No encontramos su tipo de negocio</p>
      {sent ? (
        <p className="mt-1 text-xs text-neutral-500">Gracias, lo tomamos en cuenta.</p>
      ) : (
        <>
          <div className="mt-2 flex gap-2">
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="¿Qué tipo de negocio es?"
              className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={value.trim().length === 0}
              onClick={onSend}
              className="rounded border border-blue-600 px-3 py-2 text-sm font-medium text-blue-600 disabled:opacity-40"
            >
              Enviar
            </button>
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            Esto todavía no se envía a ningún sistema — no existe un lugar donde guardarlo. Solo confirma
            que anotamos su interés en esta pantalla.
          </p>
        </>
      )}
    </div>
  );
}
