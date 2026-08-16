"use client";

import { useState } from "react";
import type { ProjectLocation } from "@sodeja/schemas";
import type { LocationDraft } from "../lib/types";
import { ConfirmAreaStep } from "./confirm/ConfirmAreaStep";
import { PoiLabelStep } from "./confirm/PoiLabelStep";
import { FitoutEstimateStep } from "./costs/FitoutEstimateStep";
import { OpexEstimateStep } from "./costs/OpexEstimateStep";
import { LayoutZonesStep } from "./layout/LayoutZonesStep";
import { LocationStep } from "./location/LocationStep";
import { MarketStudyStep } from "./market/MarketStudyStep";
import { ProjectionStep } from "./projection/ProjectionStep";
import { SummaryExportStep } from "./summary/SummaryExportStep";

type FlowStep =
  | "location"
  | "confirm"
  | "poi-label"
  | "layout"
  | "market-study"
  | "fitout"
  | "opex"
  | "projection"
  | "summary";

/**
 * The primary flow (specs/ux/flows.md), Steps 1-3 and 6-9, in this app's
 * ACTUAL order: location → confirm → poi-label → layout → market-study →
 * fitout → opex → projection → summary. Two deliberate deviations from the
 * spec's numbered order, both already forced by decisions made outside this
 * file:
 *
 * 1. Step 4 (business type) and the jurisdiction it implies do NOT appear
 *    here at all — they are answered BEFORE this component ever mounts, on
 *    `app/page.tsx`'s `BusinessTypeStep`, because `POST /projects` (B-11a)
 *    requires both at project-creation time. See that file's doc comment for
 *    the full reasoning. By the time `ProjectFlow` runs, business type and
 *    jurisdiction are already fixed.
 * 2. Step 3 (market study) is sequenced AFTER Step 4's zone allocation
 *    (`layout`) rather than immediately after Step 2, because this is where
 *    B-7 through B-13 already left the flow (`poi-label` and `layout` are
 *    gated behind the same B-7a area-confirmation this step also needs, and
 *    reordering those already-shipped, already-tested steps was out of scope
 *    for this change). Market study's own real prerequisite — a confirmed
 *    area — is satisfied regardless of exactly where in this sequence it
 *    runs.
 *
 * Step 5's capacity half (Module 6) has no screen in this app — see
 * `ProjectionStep.tsx`'s doc comment for the one place that gap is worked
 * around (a minimal inline "unblock" action, not a full capacity screen).
 *
 * B-18's permits checklist is built and reachable, but stays a link out of
 * `SummaryExportStep` rather than an appended step — same reasoning this
 * file's previous version already gave: its own preconditions (area,
 * jurisdiction, business type) are met well before the summary step, so
 * placing Module 12 as the tenth step in this sequence would misstate how
 * much of the flow precedes it.
 */
export function ProjectFlow({ projectId }: { projectId: string }) {
  const [step, setStep] = useState<FlowStep>("location");
  const [draft, setDraft] = useState<LocationDraft | null>(null);
  const [, setConfirmedLocation] = useState<ProjectLocation | null>(null);

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
        onContinue={() => setStep("market-study")}
        onBackToConfirm={() => setStep("confirm")}
      />
    );
  }

  if (step === "market-study") {
    return (
      <MarketStudyStep
        projectId={projectId}
        onContinue={() => setStep("fitout")}
        onBackToConfirm={() => setStep("confirm")}
      />
    );
  }

  if (step === "fitout") {
    return (
      <FitoutEstimateStep
        projectId={projectId}
        onContinue={() => setStep("opex")}
        onBackToConfirm={() => setStep("confirm")}
      />
    );
  }

  if (step === "opex") {
    return (
      <OpexEstimateStep
        projectId={projectId}
        onContinue={() => setStep("projection")}
        onBackToConfirm={() => setStep("confirm")}
      />
    );
  }

  if (step === "projection") {
    return (
      <ProjectionStep
        projectId={projectId}
        onContinue={() => setStep("summary")}
        onNavigateToConfirm={() => setStep("confirm")}
        onNavigateToFitout={() => setStep("fitout")}
        onNavigateToOpex={() => setStep("opex")}
      />
    );
  }

  if (step === "summary") {
    return <SummaryExportStep projectId={projectId} />;
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
