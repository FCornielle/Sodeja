"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PermitChecklist, PermitChecklistItem, PermitRequirement } from "@sodeja/schemas";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { CitationLine, formatDate } from "../common/CitationLine";

interface Props {
  projectId: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; checklist: PermitChecklist }
  | { kind: "gated"; reason: GateReason }
  | { kind: "error"; message: string };

/**
 * `GET /projects/:id/permits-checklist` answers `409` for three unrelated
 * unmet preconditions (permits.service.ts), not just B-7a's area gate: no
 * confirmed area, no jurisdiction resolved, or no business type set. The other
 * gated steps only ever see the first one, so they can assume it; this screen
 * cannot. Sending someone to re-confirm an area that is already confirmed,
 * when the real gap is a missing business type, is a dead end they cannot
 * escape from this screen — so an unrecognised 409 falls back to `unknown`
 * and says plainly that the project is not ready, rather than naming a fix
 * that would not work.
 */
type GateReason = "area" | "jurisdiction" | "business-type" | "unknown";

/**
 * Module 12 — the permits checklist (B-18).
 *
 * Reachable as its own route rather than as a step inside `ProjectFlow`.
 * The flow currently runs location → confirm → POI label → zones and stops;
 * Modules 5-11 (market study, business type, capacity, costs, projection) are
 * still unbuilt, so appending permits to that sequence would present the
 * ninth step as though it followed the fourth and imply the flow in between
 * had been completed. B-18's own preconditions do not need those modules —
 * business type and jurisdiction are set at project creation, and the area is
 * confirmed in step 2 — so the screen is fully functional today; it is only
 * its POSITION in the sequence that would be a lie.
 *
 * Two rules this screen exists to honour, both from risk L3
 * (docs/SODEJA_RISKS.md):
 *
 * 1. `disclaimerEs` renders verbatim, above the list, never collapsed. The
 *    list is not usable without it — the content was never reviewed by a
 *    lawyer and is known to be missing real requirements.
 * 2. Nothing here may read as "compliant", "cleared" or "done". There is no
 *    such `requirement` value and the UI must not manufacture one: no green,
 *    no checkmarks, no progress count, no tick boxes, and an empty or
 *    all-`not_applicable` list reads as "we found nothing to list", never as
 *    "you need nothing".
 */
export function PermitsChecklistStep({ projectId }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });

    apiFetch<PermitChecklist>(`/projects/${projectId}/permits-checklist`, { signal: controller.signal })
      .then((checklist) => setState({ kind: "loaded", checklist }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 409) {
          setState({ kind: "gated", reason: classifyGate(err.message) });
          return;
        }
        setState({
          kind: "error",
          message: "No pudimos obtener la lista de permisos y trámites de este proyecto.",
        });
      });

    return () => controller.abort();
  }, [projectId, attempt]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-5 overflow-y-auto p-6">
      <div>
        <Link href={`/project/${projectId}`} className="text-sm text-blue-600 underline">
          ← Volver al proyecto
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">Permisos y trámites</h1>
      </div>

      {state.kind === "loading" && (
        <div className="animate-pulse space-y-3" role="status" aria-label="Cargando">
          <div className="h-20 w-full rounded bg-neutral-200" />
          <div className="h-4 w-2/3 rounded bg-neutral-200" />
          <div className="h-16 w-full rounded bg-neutral-200" />
          <div className="h-16 w-full rounded bg-neutral-200" />
        </div>
      )}

      {state.kind === "gated" && <GateNotice projectId={projectId} reason={state.reason} />}

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

      {state.kind === "loaded" && <Checklist checklist={state.checklist} />}
    </div>
  );
}

function Checklist({ checklist }: { checklist: PermitChecklist }) {
  return (
    <>
      <Disclaimer text={checklist.disclaimerEs} />

      <p className="text-sm text-neutral-600">
        Trámites que, según las fuentes consultadas, suelen aplicar a un negocio de tipo{" "}
        <span className="font-medium text-neutral-800">{checklist.businessTypeSlug}</span> en{" "}
        <span className="font-medium text-neutral-800">{checklist.jurisdictionName}</span>. Consultado
        el {formatDate(checklist.asOfDate)}.
      </p>

      {checklist.items.length === 0 ? (
        <EmptyChecklist />
      ) : (
        <ol className="flex flex-col gap-3">
          {checklist.items.map((item) => (
            <ChecklistItem key={item.ruleCode} item={item} />
          ))}
        </ol>
      )}

      <p className="rounded border border-neutral-200 bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-600">
        Esta lista está incompleta por construcción y no lleva cuenta de lo que usted ya haya
        gestionado. Aunque atienda todos los puntos anteriores, eso no significa que su negocio esté
        en regla: confirme cada trámite con la institución que lo emite.
      </p>
    </>
  );
}

/**
 * The disclaimer is a precondition for the list being usable at all, so it is
 * rendered above it, at full length, in the first screenful — not in a
 * tooltip, an accordion, or a footer (`PermitChecklistSchema`: "A client MUST
 * render `disclaimerEs` as visible copy, never behind a tooltip"). The copy
 * itself is the API's, verbatim; only the framing line above it is ours.
 */
function Disclaimer({ text }: { text: string }) {
  return (
    <section
      role="note"
      aria-labelledby="permits-disclaimer-heading"
      className="rounded border-2 border-amber-400 bg-amber-50 p-4"
    >
      <h2 id="permits-disclaimer-heading" className="text-sm font-bold text-amber-900">
        Léalo antes de usar esta lista
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-amber-900">{text}</p>
    </section>
  );
}

/**
 * An empty list is a plausible real answer, and the one place this screen is
 * most likely to be misread as an all-clear. Same distinction `PoiLabelStep`
 * draws for a missing POI record: absence of a listed requirement is absence
 * of verified CONTENT, never absence of a requirement.
 */
function EmptyChecklist() {
  return (
    <div className="rounded border border-neutral-300 p-4">
      <p className="text-sm text-neutral-900">
        No tenemos ningún trámite verificado para esta combinación de tipo de negocio y municipio.
      </p>
      <p className="mt-2 text-sm text-neutral-600">
        Esto no quiere decir que su negocio no necesite permisos. Quiere decir que no hemos podido
        verificar ninguno en el texto de una fuente oficial. Diríjase al ayuntamiento de su
        municipio y a la DGII para saber qué le corresponde.
      </p>
    </div>
  );
}

function ChecklistItem({ item }: { item: PermitChecklistItem }) {
  const requirement = REQUIREMENT_COPY[item.requirement];

  return (
    <li className="rounded border border-neutral-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex-1 text-base font-semibold text-neutral-900">{item.titleEs}</h3>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${requirement.className}`}>
          {requirement.label}
        </span>
      </div>

      <p className="mt-1 text-xs text-neutral-500">{requirement.explanation}</p>

      {item.descriptionEs !== null && (
        <p className="mt-3 text-sm leading-relaxed text-neutral-700">{item.descriptionEs}</p>
      )}

      <dl className="mt-3 text-sm">
        <dt className="inline font-medium text-neutral-600">Dónde se tramita: </dt>
        <dd className="inline text-neutral-800">
          {item.agencyName ?? (
            <span className="text-neutral-500">
              la fuente no señala una institución concreta; pregunte en el ayuntamiento de su
              municipio
            </span>
          )}
        </dd>
      </dl>

      <div className="mt-3 border-t border-neutral-100 pt-2">
        <CitationLine citation={item.citation} />
        <p className="mt-1 text-xs text-neutral-400">
          Regla {item.ruleCode} · ámbito {item.jurisdictionSlug} · versión {item.rulePackVersion} ·
          publicada el {formatDate(item.effectiveFrom)}
          {item.effectiveTo !== null && <> · válida hasta el {formatDate(item.effectiveTo)}</>}
        </p>
      </div>
    </li>
  );
}

/**
 * Plain-language labels for `PermitRequirement`. Two constraints shape every
 * choice here:
 *
 * Wording — only `required` is a flat statement. `likely_required` and
 * `unknown` describe OUR state of knowledge rather than the user's obligation,
 * because that is what the rule engine actually computed; phrasing either as a
 * verdict about the business would claim a certainty no seeded rule carries.
 * `not_applicable` is scoped out loud to the one rule that produced it, so it
 * cannot be read as "nothing else applies either".
 *
 * Colour — one hue at four weights, no green and no red. Green (and any
 * checkmark) would render an all-clear the vocabulary deliberately has no word
 * for; red would make a routine, expected registration look like a violation
 * on a screen whose job is to be non-alarming. Weight alone carries the
 * "attend to this first" ordering.
 */
const REQUIREMENT_COPY: Record<
  PermitRequirement,
  { label: string; explanation: string; className: string }
> = {
  required: {
    label: "Obligatorio",
    explanation: "La fuente citada lo exige de forma expresa.",
    className: "border-blue-700 bg-blue-700 text-white",
  },
  likely_required: {
    label: "Probablemente le aplica",
    explanation:
      "La regla citada apunta a que aplica a un negocio como el suyo, pero depende de detalles que el sistema no conoce. Confírmelo antes de darlo por hecho.",
    className: "border-blue-300 bg-blue-50 text-blue-900",
  },
  unknown: {
    label: "No hemos podido determinarlo",
    explanation:
      "La fuente no permite decidir si le aplica o no. No lo descarte: pregúntelo en la institución correspondiente.",
    className: "border-neutral-400 bg-neutral-100 text-neutral-800",
  },
  not_applicable: {
    label: "Esta regla no le aplica",
    explanation:
      "Por el tipo de negocio, esta regla concreta no se activa. No le exime de ningún otro trámite de esta lista ni de los que no aparecen en ella.",
    className: "border-neutral-300 bg-white text-neutral-600",
  },
};

function GateNotice({ projectId, reason }: { projectId: string; reason: GateReason }) {
  const copy = GATE_COPY[reason];

  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p>{copy.message}</p>
      {copy.showBackToProject && (
        <Link href={`/project/${projectId}`} className="mt-2 inline-block font-medium text-blue-600 underline">
          Volver a confirmar el área
        </Link>
      )}
    </div>
  );
}

const GATE_COPY: Record<GateReason, { message: string; showBackToProject: boolean }> = {
  area: {
    message:
      "Necesitamos el área confirmada antes de armar la lista de permisos: los trámites municipales dependen del municipio donde esté el local, y ese dato se resuelve al confirmar la ubicación.",
    showBackToProject: true,
  },
  jurisdiction: {
    message:
      "Este proyecto todavía no tiene un municipio asignado. La licencia de apertura y el uso de suelo los emite cada ayuntamiento por separado, así que sin municipio no podemos decirle a qué oficina acudir — y una lista del municipio equivocado sería peor que ninguna.",
    showBackToProject: false,
  },
  "business-type": {
    message:
      "Este proyecto todavía no tiene un tipo de negocio asignado. Varios trámites (los de manejo de alimentos, por ejemplo) dependen de él, así que sin ese dato la lista saldría incompleta sin poder avisarle de qué falta.",
    showBackToProject: false,
  },
  unknown: {
    message:
      "Este proyecto aún no reúne los datos necesarios para armar la lista de permisos. Complete los pasos anteriores del proyecto y vuelva a intentarlo.",
    showBackToProject: false,
  },
};

/**
 * The API distinguishes the three 409 causes only in the exception message —
 * there is no machine-readable code on the body to switch on. Matching text is
 * admittedly brittle, so the fallback is the safe one: an unmatched message
 * becomes `unknown`, which offers no specific fix, rather than being assumed
 * to be the area gate.
 */
function classifyGate(message: string): GateReason {
  if (message.includes("no confirmed area")) return "area";
  if (message.includes("no jurisdiction resolved") || message.includes("jurisdiction_id")) {
    return "jurisdiction";
  }
  if (message.includes("no business type") || message.includes("business_type_id")) {
    return "business-type";
  }
  return "unknown";
}
