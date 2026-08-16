import { z } from "zod";

/**
 * Mirrors `app.report_tier` (specs/db/schema.sql). `plan_negocio` is a real
 * enum member (the schema/CHECK must accept it once B-26 exists) but B-19's
 * `POST /projects/:id/reports` rejects a request for it with a `400` —
 * Phase 1 ships only `resumen_analisis` (docs/SODEJA_MVP_BACKLOG.md; UX spec
 * Secondary Flow C: "Phase 1 offers only this tier; the bank-facing 'Plan de
 * Negocio' is visibly marked Próximamente rather than hidden").
 */
export const ReportTierSchema = z.enum(["resumen_analisis", "plan_negocio"]);
export type ReportTier = z.infer<typeof ReportTierSchema>;

/** Mirrors `app.report_status` (specs/db/schema.sql). */
export const ReportStatusSchema = z.enum(["queued", "rendering", "ready", "failed"]);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

/**
 * `POST /projects/:id/reports` body. `tier` defaults to `'resumen_analisis'`
 * — the only tier this MVP slice actually renders.
 */
export const CreateReportRequestSchema = z.object({
  tier: ReportTierSchema.default("resumen_analisis"),
});
export type CreateReportRequest = z.infer<typeof CreateReportRequestSchema>;

/**
 * The wire contract for one `app.report` row — returned by `POST
 * /projects/:id/reports` (`202`), `GET /projects/:id/reports`, and `GET
 * /projects/:id/reports/:reportId` (status polling, per the UX spec's
 * Secondary Flow C: "the user may navigate away; the report appears in a
 * list and notifies on completion").
 *
 * `storageKey` is deliberately NOT exposed here — the client never needs the
 * internal storage path, only `GET
 * /projects/:id/reports/:reportId/download` once `status === 'ready'`. This
 * mirrors how a real signed-URL storage driver would also keep its internal
 * object key private and hand back a URL instead (see
 * services/pdf-worker/src/storage.ts's header for why this MVP's filesystem
 * driver's "download" is a direct authenticated endpoint rather than an
 * actual signed URL).
 */
export const ReportSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  requestedBy: z.string().uuid(),
  tier: ReportTierSchema,
  status: ReportStatusSchema,
  /** Pinned once `status === 'ready'` (null before then, and always null on a `'failed'` report). */
  financialProjectionId: z.string().uuid().nullable(),
  /** `@sodeja/calc` `ENGINE_VERSION` pinned at render time; null until the render has started producing figures. */
  engineVersion: z.string().nullable(),
  /** `app.legal_document.id` of the disclaimer actually rendered into the PDF. Null until `status === 'ready'`. */
  disclaimerDocumentId: z.number().int().nullable(),
  /** Set only when `status === 'failed'` — never left unexplained (UX spec Secondary Flow C: "Named reason and a retry"). */
  failureReason: z.string().nullable(),
  requestedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type Report = z.infer<typeof ReportSchema>;
