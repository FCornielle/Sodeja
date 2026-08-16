import { describe, expect, it } from "vitest";
import { renderReportPdf } from "./render.js";
import type { ReportRenderInput } from "./types.js";

/**
 * A minimal-but-complete fixture: every section is `available: false`
 * except the fields that are always present (`project`, `location`,
 * `disclaimer`, `assumptions`) — exercises the graceful-degrade path every
 * real render hits for a project with few upstream estimates computed, and
 * is enough to prove the FULL pipeline (React SSR -> Playwright -> PDF
 * bytes) actually produces a real, non-empty PDF file, not just that the
 * code typechecks.
 */
function buildFixture(): ReportRenderInput {
  return {
    reportId: "11111111-1111-1111-1111-111111111111",
    tier: "resumen_analisis",
    generatedAt: new Date().toISOString(),
    engineVersion: "1.0.0",
    project: {
      name: "Restaurante de Prueba",
      businessTypeNameEs: "Restaurante",
      jurisdictionName: "Distrito Nacional",
      reportingCurrency: "DOP",
    },
    location: { areaSqm: 100, areaSource: "user_entered", areaConfirmedAt: new Date().toISOString() },
    marketStudy: { available: false, reason: "no se ha calculado un estudio de mercado" },
    capacity: { available: false, reason: "no se ha calculado una estimación de capacidad" },
    layout: { available: false, reason: "no se ha calculado la distribución" },
    fitout: { available: false, reason: "no se ha calculado el costo de habilitación" },
    opex: { available: false, reason: "no se han calculado costos operativos" },
    financialProjection: { available: false, reason: "no se ha calculado una proyección financiera" },
    permits: { available: false, reason: "no se ha resuelto la jurisdicción" },
    assumptions: [],
    disclaimer: {
      id: 1,
      kind: "disclaimer",
      version: "1",
      locale: "es-DO",
      bodyMd: "# Aviso legal\n\nEste es un texto de prueba, **no** es asesoría legal.\n\n- Punto uno\n- Punto dos",
      effectiveFrom: "2026-08-16",
    },
  };
}

describe("renderReportPdf (real Chromium)", () => {
  it("produces a non-empty, well-formed PDF buffer from a minimal (mostly degraded) report", async () => {
    const buffer = await renderReportPdf(buildFixture());
    expect(buffer.length).toBeGreaterThan(1000);
    // PDF files start with the literal magic bytes "%PDF-".
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 60_000);
});
