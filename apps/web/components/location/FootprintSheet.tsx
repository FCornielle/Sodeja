import type { BuildingFootprint } from "@sodeja/schemas";

export type TapState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "candidates"; candidates: BuildingFootprint[] }
  | { kind: "no-candidate" };

interface Props {
  tapState: TapState;
  onSelectCandidate: (footprint: BuildingFootprint) => void;
  onStartDraw: () => void;
  onTypeArea: () => void;
}

const SHEET_CLASS =
  "absolute inset-x-0 bottom-0 z-10 max-h-[60vh] overflow-y-auto bg-white px-4 py-4 shadow-[0_-2px_10px_rgba(0,0,0,0.12)]";

/**
 * Step 1's bottom sheet (specs/ux/flows.md state table). Copy is verbatim
 * where the spec quotes it. `BuildingFootprint` never carries an address
 * (only geom/area/source — @sodeja/schemas geo.ts), so "address if known"
 * always renders as an explicit "no disponible" rather than being silently
 * omitted — apps/web/README.md's "never a bare number" extends to never a
 * silently-missing field either.
 */
export function FootprintSheet({ tapState, onSelectCandidate, onStartDraw, onTypeArea }: Props) {
  if (tapState.kind === "idle") {
    return (
      <div className={SHEET_CLASS} role="status">
        <p className="text-center text-sm text-neutral-600">Toque el edificio o local que quiere evaluar.</p>
      </div>
    );
  }

  if (tapState.kind === "loading") {
    return (
      <div className={SHEET_CLASS} role="status" aria-label="Cargando">
        <div className="animate-pulse space-y-2">
          <div className="h-4 w-1/2 rounded bg-neutral-200" />
          <div className="h-3 w-1/3 rounded bg-neutral-200" />
          <div className="h-10 w-full rounded bg-neutral-200" />
        </div>
      </div>
    );
  }

  if (tapState.kind === "no-candidate") {
    return (
      <div className={SHEET_CLASS}>
        <p className="text-sm text-neutral-700">
          No tenemos el contorno de este edificio. Puede dibujarlo o escribir el área directamente.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onStartDraw}
            className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white"
          >
            Dibujar el contorno
          </button>
          <button
            type="button"
            onClick={onTypeArea}
            className="flex-1 rounded border border-blue-600 px-3 py-2 text-sm font-medium text-blue-600"
          >
            Escribir el área
          </button>
        </div>
      </div>
    );
  }

  const { candidates } = tapState;
  const isMultiple = candidates.length > 1;

  return (
    <div className={SHEET_CLASS}>
      {isMultiple && (
        <p className="mb-2 text-xs text-neutral-500">
          Encontramos varios contornos superpuestos. Elija el correcto.
        </p>
      )}
      <ul className="space-y-2">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              onClick={() => onSelectCandidate(candidate)}
              className="w-full rounded border border-neutral-200 p-3 text-left hover:border-blue-500"
            >
              <div className="text-sm font-semibold text-neutral-900">
                {candidate.areaSqm.toFixed(0)} m² <span className="font-normal text-neutral-500">(aprox.)</span>
              </div>
              <div className="text-xs text-neutral-500">Dirección: no disponible</div>
              <div className="text-xs text-neutral-500">
                Fuente: {candidate.source} · {candidate.sourceVintage}
              </div>
              <div className="mt-2 text-sm font-medium text-blue-600">Confirmar este espacio</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
