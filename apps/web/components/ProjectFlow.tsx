"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProjectLocation } from "@sodeja/schemas";
import type { LocationDraft } from "../lib/types";
import { ConfirmAreaStep } from "./confirm/ConfirmAreaStep";
import { PoiLabelStep } from "./confirm/PoiLabelStep";
import { LayoutZonesStep } from "./layout/LayoutZonesStep";
import { LocationStep } from "./location/LocationStep";

type FlowStep = "location" | "confirm" | "poi-label" | "layout" | "done";

/**
 * Steps 1-2 + Secondary Flow A (specs/ux/flows.md, B-7), plus B-8's POI
 * use-label and B-13's zone allocation, both immediately after the area gate
 * passes — `GET /projects/:id/poi-label` and `GET /projects/:id/
 * layout-parameters` are gated behind that confirmation, so neither can be
 * asked earlier. The remaining steps (market study, business type,
 * capacity/cost, projection, export) are separate, unbuilt backlog items —
 * reaching "done" here shows a plain placeholder rather than pretending to
 * continue the real 9-step flow.
 *
 * B-18's permits checklist is built and reachable, but it is linked out of
 * that placeholder instead of appended as a step: its own preconditions are
 * already met here, yet placing Module 12 immediately after Module 4 would
 * imply the seven modules in between had been completed.
 */
export function ProjectFlow({ projectId }: { projectId: string }) {
  const [step, setStep] = useState<FlowStep>("location");
  const [draft, setDraft] = useState<LocationDraft | null>(null);
  const [confirmedLocation, setConfirmedLocation] = useState<ProjectLocation | null>(null);

  if (step === "confirm" && draft) {
    return (
      <ConfirmAreaStep
        projectId={projectId}
        draft={draft}
        onBack={() => setStep("location")}
        onConfirmed={(location) => {
          setConfirmedLocation(location);
          setStep("poi-label");
        }}
      />
    );
  }

  if (step === "poi-label") {
    return (
      <PoiLabelStep
        projectId={projectId}
        onContinue={() => setStep("layout")}
        onBackToConfirm={() => setStep("confirm")}
      />
    );
  }

  if (step === "layout") {
    return (
      <LayoutZonesStep
        projectId={projectId}
        onContinue={() => setStep("done")}
        onBackToConfirm={() => setStep("confirm")}
      />
    );
  }

  if (step === "done" && confirmedLocation) {
    return (
      <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold text-neutral-900">Área confirmada</h1>
        <p className="text-sm text-neutral-600">
          {confirmedLocation.areaSqm.toFixed(0)} m² · fuente: {confirmedLocation.areaSource}
        </p>
        <p className="text-xs text-neutral-500">
          Los pasos siguientes (mercado, tipo de negocio, capacidad, costos, proyección) no forman
          parte de este cambio (B-7).
        </p>
        <Link
          href={`/project/${projectId}/permits`}
          className="mt-2 rounded border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600"
        >
          Ver permisos y trámites
        </Link>
        <p className="text-xs text-neutral-500">
          Disponible por separado: no es el paso siguiente del flujo, sino una lista que ya se puede
          consultar con los datos de este proyecto.
        </p>
        <button
          type="button"
          onClick={() => {
            setDraft(null);
            setConfirmedLocation(null);
            setStep("location");
          }}
          className="mt-2 rounded border border-neutral-300 px-4 py-2 text-sm"
        >
          Confirmar otra ubicación
        </button>
      </div>
    );
  }

  return (
    <LocationStep
      onDraftReady={(nextDraft) => {
        setDraft(nextDraft);
        setStep("confirm");
      }}
    />
  );
}
