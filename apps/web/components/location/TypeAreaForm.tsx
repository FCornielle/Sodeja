"use client";

import { useState } from "react";
import { isAreaImplausible } from "../../lib/geometry";

interface Props {
  onConfirm: (areaSqm: number) => void;
  onCancel: () => void;
}

/**
 * Secondary Flow A step 4: "Alternative path — type the area. For users who
 * know the number and should not be forced to draw. Recorded as
 * `user_entered`." Same implausible-area band as the draw path (5m²/5000m²)
 * — a warning, never a block.
 */
export function TypeAreaForm({ onConfirm, onCancel }: Props) {
  const [rawValue, setRawValue] = useState("");
  const parsed = Number(rawValue);
  const isValid = rawValue.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;
  const implausible = isValid && isAreaImplausible(parsed);

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 bg-white px-4 py-4 shadow-[0_-2px_10px_rgba(0,0,0,0.12)]">
      <label className="block text-sm font-medium text-neutral-700" htmlFor="typed-area">
        Área (m²)
      </label>
      <input
        id="typed-area"
        type="number"
        min={0}
        step="0.1"
        value={rawValue}
        onChange={(e) => setRawValue(e.target.value)}
        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-lg"
        placeholder="Ej. 85"
      />
      {implausible && (
        <p className="mt-1 text-sm text-amber-700">Esta área es inusual ({parsed.toFixed(0)} m²). ¿Es correcto?</p>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onCancel} className="rounded border border-neutral-300 px-3 py-2 text-sm">
          Cancelar
        </button>
        <button
          type="button"
          disabled={!isValid}
          onClick={() => onConfirm(parsed)}
          className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}
