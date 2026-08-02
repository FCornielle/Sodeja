import { isAreaImplausible } from "../../lib/geometry";

interface Props {
  pointCount: number;
  invalid: boolean;
  areaSqm: number | null;
  onUndo: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onSwitchToTypeArea: () => void;
}

/**
 * Secondary Flow A's draw mode panel — validation states exactly as
 * specified (specs/ux/flows.md): "< 3 points: Confirm disabled, 'Necesita
 * al menos 3 puntos.'"; "Self-intersecting: ... 'El contorno se cruza.'";
 * "Implausible area (< 5 m² or > 5,000 m²): warning, not a block." The
 * implausibility band and self-intersection flag both come from
 * lib/geometry.ts (real @turf/area + @turf/kinks), passed down from
 * useDrawPolygon rather than recomputed here.
 */
export function DrawPanel({ pointCount, invalid, areaSqm, onUndo, onConfirm, onCancel, onSwitchToTypeArea }: Props) {
  const hasEnoughPoints = pointCount >= 3;
  const canConfirm = hasEnoughPoints && !invalid;
  const implausible = areaSqm !== null && isAreaImplausible(areaSqm);

  let disabledReason: string | null = null;
  if (!hasEnoughPoints) disabledReason = "Necesita al menos 3 puntos.";
  else if (invalid) disabledReason = "El contorno se cruza.";

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 bg-white px-4 py-4 shadow-[0_-2px_10px_rgba(0,0,0,0.12)]">
      <p className="text-sm text-neutral-700">
        Toque el mapa para agregar vértices. Arrastre un vértice para ajustarlo.
      </p>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-lg font-semibold text-neutral-900">
          {areaSqm !== null ? `${areaSqm.toFixed(0)} m²` : "— m²"}
        </span>
        <span className="text-xs text-neutral-500">{pointCount} punto(s)</span>
      </div>

      {disabledReason && (
        <p className="mt-1 text-sm text-red-600" role="alert">
          {disabledReason}
        </p>
      )}
      {!disabledReason && implausible && (
        <p className="mt-1 text-sm text-amber-700">Esta área es inusual ({areaSqm!.toFixed(0)} m²). ¿Es correcto?</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onUndo}
          disabled={pointCount === 0}
          className="rounded border border-neutral-300 px-3 py-2 text-sm disabled:opacity-40"
        >
          Deshacer último punto
        </button>
        <button type="button" onClick={onSwitchToTypeArea} className="rounded border border-neutral-300 px-3 py-2 text-sm">
          Escribir el área en su lugar
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-neutral-300 px-3 py-2 text-sm">
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm}
          title={disabledReason ?? undefined}
          className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Usar este contorno
        </button>
      </div>
    </div>
  );
}
