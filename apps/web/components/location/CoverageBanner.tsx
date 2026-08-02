import type { CoverageResult } from "@sodeja/schemas";

/**
 * UX spec Step 1: "Outside a launch area | Non-blocking banner... Tapping
 * is disabled; the map still pans so the user can see the covered areas."
 * Copy is verbatim from specs/ux/flows.md. Rendering this banner is the
 * only effect of an uncovered point on this screen — LocationStep.tsx
 * disables the tap-to-select handler while it is shown, but never disables
 * panning/zooming.
 */
export function CoverageBanner({ coverage }: { coverage: CoverageResult | null }) {
  if (!coverage || coverage.covered) return null;
  return (
    <div
      role="status"
      className="absolute inset-x-0 top-0 z-20 border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm text-amber-900"
    >
      Todavía no cubrimos esta zona. El análisis está disponible en Distrito Nacional, Santo Domingo y Santiago.
    </div>
  );
}
