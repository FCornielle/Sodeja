"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Report, ReportStatus } from "@sodeja/schemas";
import { API_BASE_URL, apiFetch, ApiError } from "../../lib/apiClient";
import { getDevUserId } from "../../lib/userId";
import { formatDate } from "../common/CitationLine";

interface Props {
  projectId: string;
}

const POLL_INTERVAL_MS = 3000;

const STATUS_LABEL: Record<ReportStatus, string> = {
  queued: "En cola",
  rendering: "Generando",
  ready: "Listo",
  failed: "Falló",
};

/**
 * Step 9 — Resumen y exportación (Module 13) + Secondary Flow C
 * (specs/ux/flows.md). This screen is the primary flow's last step and the
 * only place this app links out to `PermitsChecklistStep`, per
 * `ProjectFlow.tsx`'s own documented precedent for why permits is a link,
 * not an appended step.
 *
 * There is no "everything on one scrollable page: site, environment,
 * capacity, costs, projection, permits" summary rendered HERE — that content
 * lives in the exported PDF itself (B-19's `reports` module renders every
 * upstream module's latest stored figures server-side). Re-fetching and
 * re-rendering all of it a second time in this screen would duplicate
 * `services/pdf-worker`'s own rendering logic for no real benefit; this
 * screen's job is the export flow (gate → queued → ready/failed), which is
 * Secondary Flow C in full.
 */
export function SummaryExportStep({ projectId }: Props) {
  const [reports, setReports] = useState<Report[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    apiFetch<Report[]>(`/projects/${projectId}/reports`)
      .then((list) => {
        setReports(list);
        for (const r of list) {
          if (r.status === "queued" || r.status === "rendering") startPolling(r.id);
        }
      })
      .catch(() => {
        // History is best-effort; the export action below still works.
      });
    const timers = pollTimers.current;
    return () => {
      for (const t of timers.values()) clearInterval(t);
    };
    // `startPolling` intentionally omitted from the dependency array: it is
    // stable for the component's lifetime (only reads/writes the
    // `pollTimers` ref and `setReports`), and including it would refire this
    // effect on every render.
  }, [projectId]);

  function startPolling(reportId: string): void {
    if (pollTimers.current.has(reportId)) return;
    const timer = setInterval(() => {
      apiFetch<Report>(`/projects/${projectId}/reports/${reportId}`)
        .then((updated) => {
          setReports((prev) => prev.map((r) => (r.id === reportId ? updated : r)));
          if (updated.status === "ready" || updated.status === "failed") {
            clearInterval(timer);
            pollTimers.current.delete(reportId);
          }
        })
        .catch(() => {
          // Transient failure — keep polling, the interval is left running.
        });
    }, POLL_INTERVAL_MS);
    pollTimers.current.set(reportId, timer);
  }

  async function handleExport(): Promise<void> {
    setCreating(true);
    setCreateError(null);
    try {
      const report = await apiFetch<Report>(`/projects/${projectId}/reports`, {
        method: "POST",
        body: { tier: "resumen_analisis" },
      });
      setReports((prev) => [report, ...prev]);
      startPolling(report.id);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "No se pudo iniciar la generación del documento.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-5 overflow-y-auto p-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Resumen del análisis</h1>
      </div>

      <PreExportGate creating={creating} error={createError} onExport={handleExport} />

      {reports.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-neutral-800">Documentos generados</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {reports.map((r) => (
              <ReportRow key={r.id} report={r} projectId={projectId} onRetry={handleExport} />
            ))}
          </ul>
        </div>
      )}

      <Link
        href={`/project/${projectId}/permits`}
        className="mt-2 self-start rounded border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600"
      >
        Ver permisos y trámites
      </Link>
    </div>
  );
}

/**
 * Confirmation copy is VERBATIM from the spec (Secondary Flow C, step 2).
 * The `plan_negocio` tier is shown, disabled, marked "Próximamente" — never
 * hidden and never requestable (the API 400s a request for it).
 */
function PreExportGate({
  creating,
  error,
  onExport,
}: {
  creating: boolean;
  error: string | null;
  onExport: () => void;
}) {
  return (
    <div className="rounded border border-neutral-200 p-4">
      <p className="text-sm leading-relaxed text-neutral-800">
        Este documento es un <strong>resumen de análisis</strong>, no un plan de negocio auditado. Los
        números provienen de sus supuestos y de estimaciones del sistema. No debe usarse como única
        base para una decisión de inversión o financiamiento.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded border border-blue-600 bg-blue-50 p-3">
          <p className="text-sm font-semibold text-blue-900">Resumen de análisis</p>
          <p className="mt-1 text-xs text-blue-800">Disponible ahora.</p>
        </div>
        <div className="rounded border border-neutral-200 bg-neutral-50 p-3 opacity-60">
          <p className="text-sm font-semibold text-neutral-700">Plan de Negocio</p>
          <p className="mt-1 text-xs text-neutral-500">Próximamente</p>
        </div>
      </div>

      {error !== null && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onExport}
        disabled={creating}
        className="mt-4 rounded bg-blue-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-40"
      >
        {creating ? "Iniciando..." : "Exportar resumen"}
      </button>
    </div>
  );
}

function ReportRow({ report, projectId, onRetry }: { report: Report; projectId: string; onRetry: () => void }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function handleDownload(): Promise<void> {
    setDownloading(true);
    setDownloadError(null);
    try {
      await triggerDownload(projectId, report.id);
    } catch {
      setDownloadError("No se pudo descargar el documento.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <li className="rounded border border-neutral-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[report.status]}`}>
          {STATUS_LABEL[report.status]}
        </span>
        <span className="text-xs text-neutral-500">Solicitado el {formatDate(report.requestedAt)}</span>
      </div>

      {(report.status === "queued" || report.status === "rendering") && (
        <p className="mt-2 text-sm text-neutral-700">
          Estamos generando su documento. Puede navegar a otra pantalla; esta lista se actualizará sola.
        </p>
      )}

      {report.status === "ready" && (
        <div className="mt-2 flex flex-col gap-1">
          <p className="text-xs text-neutral-500">
            {report.completedAt !== null && <>Generado el {formatDate(report.completedAt)} · </>}
            {report.engineVersion !== null && <>motor {report.engineVersion}</>}
            {" · "}versión del reglamento aplicado: no expuesta por esta respuesta (limitación conocida —
            `Report` no incluye un campo de versión de rule-pack; ver el informe de esta tarea).
          </p>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="mt-1 self-start rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {downloading ? "Descargando..." : "Descargar PDF"}
          </button>
          {downloadError !== null && (
            <p className="text-xs text-red-600" role="alert">
              {downloadError}
            </p>
          )}
        </div>
      )}

      {report.status === "failed" && (
        <div className="mt-2">
          <p className="text-sm text-red-700">{report.failureReason ?? "No se pudo generar el documento."}</p>
          <button type="button" onClick={onRetry} className="mt-1 font-medium text-blue-600 underline">
            Reintentar
          </button>
        </div>
      )}
    </li>
  );
}

const STATUS_CLASS: Record<ReportStatus, string> = {
  queued: "border-neutral-300 bg-neutral-100 text-neutral-700",
  rendering: "border-blue-300 bg-blue-50 text-blue-900",
  ready: "border-green-300 bg-green-50 text-green-900",
  failed: "border-red-300 bg-red-50 text-red-900",
};

/**
 * `GET /projects/:id/reports/:reportId/download` returns raw PDF bytes
 * (`Content-Type: application/pdf`), not a redirect — this app triggers a
 * real browser download from the response blob rather than trying to render
 * it inline, per the task's instruction. Bypasses `apiFetch` (which always
 * parses JSON) and calls `fetch` directly, same auth header it attaches.
 */
async function triggerDownload(projectId: string, reportId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/projects/${projectId}/reports/${reportId}/download`, {
    headers: { "x-user-id": getDevUserId() },
  });
  if (!res.ok) throw new Error(`download failed with status ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sodeja-resumen-${reportId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
