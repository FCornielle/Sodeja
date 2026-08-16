"use client";

import { useEffect, useState } from "react";
import type { ProjectPoiLabel } from "@sodeja/schemas";
import { apiFetch, ApiError } from "../../lib/apiClient";

interface Props {
  projectId: string;
  onContinue: () => void;
  onBackToConfirm: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; label: ProjectPoiLabel }
  | { kind: "gated" }
  | { kind: "error"; message: string };

type Answer = "correct" | "incorrect";

/**
 * Step 2b — the POI use-label at the confirmed site (B-8, Module 2).
 * `GET /projects/:id/poi-label` only answers once the area gate has passed,
 * so this step sits immediately after `ConfirmAreaStep`.
 *
 * An all-`null` response is a real answer, not an error: informal DR
 * businesses appear in no dataset (risk D2), so "no encontramos un negocio
 * registrado" must read as absence of a RECORD, never as absence of a
 * business, and never as a failure. Same distinction `FootprintSheet` draws
 * for a missing outline.
 *
 * The user's confirm/override is informational only — there is no endpoint
 * that persists it (`app.project_location` has no column for a use-label,
 * and B-8's backend slice deliberately added no write path). The
 * acknowledgment below says so out loud rather than implying the answer was
 * saved; see this task's report for the gap note.
 */
export function PoiLabelStep({ projectId, onContinue, onBackToConfirm }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });

    apiFetch<ProjectPoiLabel>(`/projects/${projectId}/poi-label`, { signal: controller.signal })
      .then((label) => setState({ kind: "loaded", label }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 409) {
          setState({ kind: "gated" });
          return;
        }
        setState({
          kind: "error",
          message: "No pudimos consultar qué hay registrado en este sitio.",
        });
      });

    return () => controller.abort();
  }, [projectId, attempt]);

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-neutral-900">Uso actual del sitio</h1>

      {state.kind === "loading" && (
        <div className="animate-pulse space-y-2" role="status" aria-label="Cargando">
          <div className="h-4 w-2/3 rounded bg-neutral-200" />
          <div className="h-3 w-1/3 rounded bg-neutral-200" />
          <div className="h-10 w-full rounded bg-neutral-200" />
        </div>
      )}

      {state.kind === "gated" && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>Necesitamos el área confirmada antes de consultar qué hay en este sitio.</p>
          <button
            type="button"
            onClick={onBackToConfirm}
            className="mt-2 font-medium text-blue-600 underline"
          >
            Volver a confirmar el área
          </button>
        </div>
      )}

      {state.kind === "error" && (
        <div className="text-sm text-neutral-700" role="alert">
          <p>{state.message}</p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="mt-2 font-medium text-blue-600 underline"
          >
            Reintentar
          </button>
        </div>
      )}

      {state.kind === "loaded" && answer === null && <PoiQuestion label={state.label} onAnswer={setAnswer} />}

      {state.kind === "loaded" && answer !== null && (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          <p className="font-medium text-neutral-900">
            {answer === "correct" ? "Gracias, lo tomamos en cuenta." : "Gracias, lo tendremos presente."}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Esta respuesta todavía no se guarda: el sistema aún no tiene dónde registrar el uso
            actual del sitio. No afecta el análisis que sigue.
          </p>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        {state.kind !== "gated" && (
          <button
            type="button"
            onClick={onContinue}
            disabled={state.kind === "loading"}
            className="rounded bg-blue-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-40"
          >
            Continuar
          </button>
        )}
      </div>
    </div>
  );
}

function PoiQuestion({
  label,
  onAnswer,
}: {
  label: ProjectPoiLabel;
  onAnswer: (answer: Answer) => void;
}) {
  const description = describePoi(label);

  if (description === null) {
    return (
      <div className="rounded border border-neutral-200 p-3">
        <p className="text-sm text-neutral-900">
          No encontramos un negocio registrado en este sitio.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Eso no significa que no haya uno: muchos negocios no aparecen en ningún registro público.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded border border-neutral-200 p-3">
      <p className="text-sm text-neutral-900">
        Actualmente hay/había: <span className="font-semibold">{description}</span>. ¿Es correcto?
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        {label.distanceM !== null && <>A {label.distanceM.toFixed(0)} m del centro del espacio · </>}
        Fuente: registro de lugares{label.sourceVintage !== null && <> · {label.sourceVintage}</>}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onAnswer("correct")}
          className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white"
        >
          Sí, es correcto
        </button>
        <button
          type="button"
          onClick={() => onAnswer("incorrect")}
          className="flex-1 rounded border border-blue-600 px-3 py-2 text-sm font-medium text-blue-600"
        >
          No es correcto
        </button>
      </div>
    </div>
  );
}

/**
 * `category` and `name` are independently nullable: a place can be named but
 * unclassifiable, or classified but unnamed. Returns `null` only when neither
 * is known — the "no record" case.
 */
function describePoi(label: ProjectPoiLabel): string | null {
  if (label.name !== null && label.category !== null) return `${label.name} (${label.category})`;
  return label.name ?? label.category;
}
