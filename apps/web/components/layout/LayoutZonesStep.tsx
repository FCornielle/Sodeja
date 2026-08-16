"use client";

import { useEffect, useMemo, useState } from "react";
import {
  allocateLayoutZones,
  checkLayoutZonePlausibility,
  LayoutAllocationError,
  type LayoutZoneAllocation,
  type LayoutZoneDensityCheck,
  type LayoutZonePlausibilityNote,
} from "@sodeja/calc";
import type { LayoutParameters } from "@sodeja/schemas";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { ZONE_SLUG_BY_DENSITY_PARAMETER, presetZonesFor, slugifyZoneName } from "./zoneTaxonomy";

interface Props {
  projectId: string;
  onContinue: () => void;
  onBackToConfirm: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; parameters: LayoutParameters }
  | { kind: "gated" }
  | { kind: "error"; message: string };

interface ZoneRow {
  slug: string;
  label: string;
  /** Kept as the raw string the user typed so a half-typed "1." is not clobbered. */
  shareText: string;
}

/**
 * How far a zone's implied occupant load may diverge from the expected one
 * before it is worth mentioning. `checkLayoutZonePlausibility` has no default
 * on purpose (packages/calc/src/layout.ts) — this is the caller's threshold,
 * chosen here and nowhere else.
 *
 * 2 means "the zone is at least twice, or at most half, the area the cited
 * density implies". Deliberately loose, because three separate sources of
 * slack already sit between the two numbers being compared: the seeded IBC
 * figures are single-point (value_low = base = high), so no citation spread
 * absorbs any deviation; `expectedOccupants` is a staff count the user typed
 * for the WHOLE premises rather than a measured per-zone occupancy; and an
 * IBC occupant-load factor is a life-safety egress allowance, not an
 * operational sizing target. A tighter factor would fire on ordinary small
 * premises and train the user to ignore the note, which for a never-blocking
 * informational message is the only real failure mode.
 */
const TOLERANCE_FACTOR = 2;

/**
 * Step 2c — zone allocation (B-13, Module 4). Sits after `PoiLabelStep`
 * because `GET /projects/:id/layout-parameters` is behind the same B-7a
 * area-confirmation gate: the zone areas below are shares of the CONFIRMED
 * premises area, so an unconfirmed one must not reach them.
 *
 * This screen proposes no split. Not a suggested one, not a greyed-out
 * placeholder — every zone starts empty. See `zoneTaxonomy.ts` and
 * `packages/calc/src/layout.ts` for why: the seeded IBC figures are occupant
 * densities WITHIN a zone, and no citable source states a proportion BETWEEN
 * zones. The cited densities are used for one thing only, the informational
 * plausibility note below.
 *
 * Both engine calls run client-side and live as the user types — nothing here
 * is persisted, because there is no write path: `app.layout_zone` stays empty
 * by design and B-13's backend slice added no POST. The screen says so rather
 * than implying the split was saved.
 */
export function LayoutZonesStep({ projectId, onContinue, onBackToConfirm }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [newZoneName, setNewZoneName] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });

    apiFetch<LayoutParameters>(`/projects/${projectId}/layout-parameters`, { signal: controller.signal })
      .then((parameters) => {
        setState({ kind: "loaded", parameters });
        setZones(
          presetZonesFor(
            parameters.businessTypeSlug,
            parameters.densityParameters.map((p) => p.parameterTableSlug),
          ).map((preset) => ({ ...preset, shareText: "" })),
        );
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 409) {
          setState({ kind: "gated" });
          return;
        }
        setState({
          kind: "error",
          message: "No pudimos obtener los parámetros de distribución de este local.",
        });
      });

    return () => controller.abort();
  }, [projectId, attempt]);

  const parameters = state.kind === "loaded" ? state.parameters : null;

  const result = useMemo(
    () => (parameters === null ? null : computeLayout(parameters, zones)),
    [parameters, zones],
  );

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-neutral-900">Distribución del local</h1>

      {state.kind === "loading" && (
        <div className="animate-pulse space-y-2" role="status" aria-label="Cargando">
          <div className="h-4 w-2/3 rounded bg-neutral-200" />
          <div className="h-3 w-1/3 rounded bg-neutral-200" />
          <div className="h-10 w-full rounded bg-neutral-200" />
        </div>
      )}

      {state.kind === "gated" && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>Necesitamos el área confirmada antes de repartirla en zonas.</p>
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

      {parameters !== null && result !== null && (
        <>
          <p className="text-sm text-neutral-600">
            Reparta los {parameters.areaSqm.toFixed(0)} m² confirmados entre las zonas de su local.
            El sistema no propone un reparto: no existe una fuente citable que indique qué porcentaje
            del local ocupa cada zona, así que los porcentajes los define usted.
          </p>

          <ZoneTable
            zones={zones}
            allocations={result.allocations}
            onChangeShare={(slug, shareText) =>
              setZones((rows) => rows.map((r) => (r.slug === slug ? { ...r, shareText } : r)))
            }
            onRemove={(slug) => setZones((rows) => rows.filter((r) => r.slug !== slug))}
          />

          <AddZoneForm
            value={newZoneName}
            onChange={setNewZoneName}
            onAdd={() => {
              const name = newZoneName.trim();
              if (name.length === 0) return;
              const slug = slugifyZoneName(name, zones.length + 1);
              setZones((rows) =>
                rows.some((r) => r.slug === slug) ? rows : [...rows, { slug, label: name, shareText: "" }],
              );
              setNewZoneName("");
            }}
          />

          <ShareTotals totalPercent={result.totalPercent} areaSqm={parameters.areaSqm} />

          {result.error !== null && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">
              <p className="font-medium">No se pudo calcular la distribución.</p>
              <p className="mt-1">{result.error}</p>
            </div>
          )}

          <PlausibilitySection parameters={parameters} notes={result.notes} />

          <p className="text-xs text-neutral-500">
            Este reparto no se guarda todavía: el sistema aún no tiene dónde registrar las zonas de un
            local. Los metros cuadrados de arriba se recalculan aquí mismo cada vez que usted escribe.
          </p>
        </>
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

function ZoneTable({
  zones,
  allocations,
  onChangeShare,
  onRemove,
}: {
  zones: readonly ZoneRow[];
  allocations: readonly LayoutZoneAllocation[];
  onChangeShare: (slug: string, shareText: string) => void;
  onRemove: (slug: string) => void;
}) {
  const areaBySlug = new Map(allocations.map((a) => [a.slug, a.areaSqm]));

  return (
    <ul className="flex flex-col gap-2">
      {zones.map((zone) => {
        const areaSqm = areaBySlug.get(zone.slug);
        return (
          <li key={zone.slug} className="flex items-center gap-2 rounded border border-neutral-200 p-2">
            <label htmlFor={`zone-${zone.slug}`} className="flex-1 text-sm text-neutral-800">
              {zone.label}
            </label>
            <input
              id={`zone-${zone.slug}`}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="1"
              value={zone.shareText}
              onChange={(e) => onChangeShare(zone.slug, e.target.value)}
              placeholder="0"
              className="w-20 rounded border border-neutral-300 px-2 py-1.5 text-right text-sm"
            />
            <span className="w-4 text-sm text-neutral-500">%</span>
            <span className="w-24 text-right text-sm font-medium text-neutral-900">
              {areaSqm === undefined ? "—" : `${areaSqm.toFixed(2)} m²`}
            </span>
            <button
              type="button"
              onClick={() => onRemove(zone.slug)}
              aria-label={`Quitar zona ${zone.label}`}
              className="px-1 text-sm text-neutral-400"
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AddZoneForm({
  value,
  onChange,
  onAdd,
}: {
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex gap-2">
      <input
        aria-label="Nombre de la zona a agregar"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Agregar otra zona"
        className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
      />
      <button
        type="button"
        onClick={onAdd}
        disabled={value.trim().length === 0}
        className="rounded border border-blue-600 px-3 py-2 text-sm font-medium text-blue-600 disabled:opacity-40"
      >
        Agregar
      </button>
    </div>
  );
}

function ShareTotals({ totalPercent, areaSqm }: { totalPercent: number; areaSqm: number }) {
  const remainingPercent = Math.round((100 - totalPercent) * 100) / 100;
  const over = remainingPercent < 0;

  return (
    <div className="rounded bg-neutral-50 p-3 text-sm">
      <p className="text-neutral-800">
        Asignado: <span className="font-semibold">{totalPercent.toFixed(2)}%</span>
      </p>
      <p className={over ? "mt-1 text-red-700" : "mt-1 text-neutral-600"}>
        {over
          ? `Se ha repartido ${Math.abs(remainingPercent).toFixed(2)}% más de lo que mide el local.`
          : `Sin asignar: ${remainingPercent.toFixed(2)}% (${((areaSqm * remainingPercent) / 100).toFixed(2)} m²) — circulación, pasillos y todo lo que no haya detallado.`}
      </p>
    </div>
  );
}

function PlausibilitySection({
  parameters,
  notes,
}: {
  parameters: LayoutParameters;
  notes: readonly LayoutZonePlausibilityNote[];
}) {
  if (parameters.densityParameters.length === 0) {
    return (
      <p className="rounded border border-neutral-200 p-3 text-xs text-neutral-600">
        Para este tipo de negocio no existe ninguna densidad de ocupación citada por zona, así que no
        se compara ninguna zona con un estándar. La distribución que usted indique es la única fuente.
      </p>
    );
  }

  if (parameters.expectedOccupants === null) {
    return (
      <div className="rounded border border-neutral-200 p-3 text-xs text-neutral-600">
        <p>
          Hay una densidad de ocupación citada para este tipo de negocio, pero no se puede comparar
          con nada todavía: falta el número de personas que trabajarán en el local.
        </p>
        {parameters.expectedOccupantsReason !== null && (
          <p className="mt-1 text-neutral-500">Detalle técnico: {parameters.expectedOccupantsReason}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-neutral-500">
        Las zonas con densidad citada se comparan contra {parameters.expectedOccupants}{" "}
        {parameters.expectedOccupants === 1 ? "ocupante" : "ocupantes"} (el personal estimado del
        local). Es una comparación informativa: nunca impide continuar.
      </p>
      {notes.map((note) => (
        <p
          key={note.zoneSlug}
          className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"
        >
          {note.message}
        </p>
      ))}
    </div>
  );
}

interface LayoutResult {
  allocations: LayoutZoneAllocation[];
  notes: LayoutZonePlausibilityNote[];
  totalPercent: number;
  /** `LayoutAllocationError`'s own message, verbatim, or null. */
  error: string | null;
}

/**
 * Runs both engine calls over the current input. A zone left at 0% is excluded
 * from the plausibility check rather than compared: a zone the user has not
 * filled in yet is not an allocation to sanity-check, and comparing it would
 * put a note on screen before the user has typed anything.
 */
function computeLayout(parameters: LayoutParameters, zones: readonly ZoneRow[]): LayoutResult {
  const shares = zones.map((zone) => ({
    slug: zone.slug,
    sharePercent: zone.shareText.trim().length === 0 ? 0 : Number(zone.shareText),
  }));
  const totalPercent = shares.reduce((sum, s) => sum + (Number.isFinite(s.sharePercent) ? s.sharePercent : 0), 0);

  try {
    const allocations = allocateLayoutZones(parameters.areaSqm, shares);

    const allocatedSlugs = new Set(allocations.filter((a) => a.sharePercent > 0).map((a) => a.slug));
    const checks: LayoutZoneDensityCheck[] = [];
    if (parameters.expectedOccupants !== null) {
      for (const density of parameters.densityParameters) {
        const zoneSlug = ZONE_SLUG_BY_DENSITY_PARAMETER[density.parameterTableSlug];
        if (zoneSlug === undefined || !allocatedSlugs.has(zoneSlug)) continue;
        checks.push({ zoneSlug, density, expectedOccupants: parameters.expectedOccupants });
      }
    }

    return {
      allocations,
      notes: checkLayoutZonePlausibility(allocations, checks, TOLERANCE_FACTOR),
      totalPercent,
      error: null,
    };
  } catch (err) {
    if (err instanceof LayoutAllocationError) {
      return { allocations: [], notes: [], totalPercent, error: err.message };
    }
    throw err;
  }
}
