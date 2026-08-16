import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ENGINE_VERSION } from "@sodeja/calc";
import { withUserSession } from "@sodeja/db";
import { createLogger } from "@sodeja/observability";
import { renderReportPdf, type ReportQueue, type ReportRenderInput, type ReportSection, type ReportStorage } from "@sodeja/pdf-worker";
import type { CreateReportRequest, Report } from "@sodeja/schemas";
import { requireConfirmedArea } from "../common/area-gate.js";
import { LayoutService } from "../layout/layout.service.js";
import { LegalService } from "../legal/legal.service.js";
import { PermitsService } from "../permits/permits.service.js";
import {
  fetchConfirmedLocation,
  fetchLatestCapacityEstimate,
  fetchLatestFinancialProjection,
  fetchLatestFitoutEstimate,
  fetchLatestMarketStudy,
  fetchLatestOpexEstimate,
  fetchProjectAssumptions,
  fetchReport,
  fetchReportProjectContext,
  insertReport,
  listReports as listReportRows,
  markFailed,
  markReady,
  markRendering,
  type ReportRow,
} from "./reports.repository.js";
import { REPORT_QUEUE, REPORT_STORAGE } from "./tokens.js";

const logger = createLogger("api:reports");

function toDto(row: ReportRow): Report {
  return {
    id: row.id,
    projectId: row.projectId,
    requestedBy: row.requestedBy,
    tier: row.tier,
    status: row.status,
    financialProjectionId: row.financialProjectionId,
    engineVersion: row.engineVersion,
    disclaimerDocumentId: row.disclaimerDocumentId,
    failureReason: row.failureReason,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

function storageKeyFor(projectId: string, reportId: string): string {
  return `${projectId}/${reportId}.pdf`;
}

function toSection<T>(data: T | null, reason: string): ReportSection<T> {
  return data === null ? { available: false, reason } : { available: true, data };
}

export interface ReportDownload {
  filename: string;
  data: Buffer;
}

/**
 * B-19 (Module 13, PDF export) — the integration point that assembles every
 * upstream module into a downloadable PDF (`@sodeja/pdf-worker`).
 *
 * **Prerequisite gate**: only a CONFIRMED AREA is hard-blocking (`409`, same
 * `requireConfirmedArea` gate every estimate module uses). Every other
 * upstream estimate (market-study, capacity, layout, fit-out, opex,
 * financial-projection, permits) is read on a best-effort basis and
 * gracefully degrades to a "no calculado aún" section in the rendered PDF
 * instead of blocking generation — see `renderReportJob` below for exactly
 * how, and apps/api/README.md's "B-19 contract" for why this split (not,
 * say, also hard-blocking on a financial projection): `market-study` (B-9)
 * and `layout` (B-13) are themselves optional/best-effort by their OWN
 * design (a market study can legitimately be `confidence: 'insuficiente'`;
 * layout has no server-persisted zone split at all), so making the REPORT
 * stricter than the modules that feed it would contradict their own
 * product design. A report with fewer computed sections is still a real,
 * honest artifact — an assumptions appendix and a "no calculado aún" note
 * are what the README's "Mandatory content" list exists to make truthful
 * even in that case.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(REPORT_QUEUE) private readonly queue: ReportQueue,
    @Inject(REPORT_STORAGE) private readonly storage: ReportStorage,
    private readonly permitsService: PermitsService,
    private readonly layoutService: LayoutService,
    private readonly legalService: LegalService,
  ) {}

  async createReport(userId: string, projectId: string, input: CreateReportRequest): Promise<Report> {
    if (input.tier === "plan_negocio") {
      // Phase 2 / B-26 (docs/SODEJA_MVP_BACKLOG.md). Rejected rather than
      // silently downgraded to 'resumen_analisis': a caller that explicitly
      // asked for the bank-facing tier should learn it does not exist yet,
      // not receive a different document than the one it requested (UX spec
      // Secondary Flow C: "Plan de Negocio" is marked "Próximamente", never
      // silently substituted).
      throw new BadRequestException(
        "the 'plan_negocio' tier is not available yet (Phase 2, B-26) — the client must mark it " +
          "'Próximamente' rather than request it (specs/ux/flows.md Secondary Flow C)",
      );
    }

    const row = await withUserSession(userId, async (client) => {
      // The ONE hard-blocking gate — see this class's own doc comment.
      await requireConfirmedArea(client, projectId);
      return insertReport(client, projectId, userId, input.tier);
    });

    // Fire-and-forget dispatch onto the in-memory queue (@sodeja/pdf-worker's
    // InMemoryReportQueue) — the POST request returns 202 immediately, and
    // the render runs after this call returns. Errors are caught INSIDE
    // renderReportJob (which always marks the report 'failed' rather than
    // leaving it 'rendering' forever); this .catch is a last-resort guard in
    // case that contract is somehow broken.
    this.queue.enqueue(() =>
      this.renderReportJob(userId, projectId, row.id).catch((error: unknown) => {
        logger.error({ err: error, projectId, reportId: row.id }, "unhandled error in report render job");
      }),
    );

    return toDto(row);
  }

  async getReport(userId: string, projectId: string, reportId: string): Promise<Report> {
    return withUserSession(userId, async (client) => {
      const row = await fetchReport(client, projectId, reportId);
      if (!row) throw new NotFoundException(`report ${reportId} not found`);
      return toDto(row);
    });
  }

  async listReports(userId: string, projectId: string): Promise<Report[]> {
    return withUserSession(userId, async (client) => (await listReportRows(client, projectId)).map(toDto));
  }

  async downloadReport(userId: string, projectId: string, reportId: string): Promise<ReportDownload> {
    const row = await withUserSession(userId, (client) => fetchReport(client, projectId, reportId));
    if (!row) throw new NotFoundException(`report ${reportId} not found`);
    if (row.status !== "ready" || !row.storageKey) {
      throw new ConflictException(`report ${reportId} is not ready yet (status: ${row.status})`);
    }
    const data = await this.storage.read(row.storageKey);
    if (!data) {
      // Should not happen (storage.save preceded the DB write to 'ready' in
      // renderReportJob), but a missing file must never be reported as a
      // silently empty download.
      throw new NotFoundException(`report ${reportId} is marked ready but its file is missing from storage`);
    }
    return { filename: `sodeja-resumen-${reportId}.pdf`, data };
  }

  /**
   * The render job, run by the queue well after the `POST` that enqueued it
   * has already returned. Opens its OWN `withUserSession` scopes (the
   * request's own transaction is long gone by the time this runs) —
   * multiple short-lived transactions rather than one long one, so a slow
   * Chromium render never holds a database transaction open.
   */
  private async renderReportJob(userId: string, projectId: string, reportId: string): Promise<void> {
    await withUserSession(userId, (client) => markRendering(client, reportId));

    try {
      const disclaimer = await this.legalService.getCurrentDocument("disclaimer");

      const gathered = await withUserSession(userId, async (client) => {
        const projectContext = await fetchReportProjectContext(client, projectId);
        const location = await fetchConfirmedLocation(client, projectId);
        if (!projectContext || !location) {
          // requireConfirmedArea already passed in createReport, so this
          // would mean the project or its confirmed location vanished
          // between then and now — not expected, but fail loudly rather
          // than render from nulls.
          throw new Error(`internal: project ${projectId} lost its context/confirmed location before rendering`);
        }
        return {
          projectContext,
          location,
          marketStudy: toSection(await fetchLatestMarketStudy(client, projectId), "no se ha calculado un estudio de mercado (Módulo 1)"),
          capacity: toSection(await fetchLatestCapacityEstimate(client, projectId), "no se ha calculado una estimación de capacidad (Módulo 6)"),
          fitout: toSection(await fetchLatestFitoutEstimate(client, projectId), "no se ha calculado un costo de habilitación (Módulo 9)"),
          opex: toSection(await fetchLatestOpexEstimate(client, projectId), "no se han calculado costos operativos (Módulo 10)"),
          financialProjection: toSection(
            await fetchLatestFinancialProjection(client, projectId),
            "no se ha calculado una proyección financiera (Módulo 7)",
          ),
          assumptions: await fetchProjectAssumptions(client, projectId),
        };
      });

      const layout = await this.readSection(() => this.layoutService.getLayoutParameters(userId, projectId));
      const permits = await this.readSection(() => this.permitsService.getPermitsChecklist(userId, projectId));

      const renderInput: ReportRenderInput = {
        reportId,
        tier: "resumen_analisis",
        generatedAt: new Date().toISOString(),
        engineVersion: ENGINE_VERSION,
        project: {
          name: gathered.projectContext.name,
          businessTypeNameEs: gathered.projectContext.businessTypeNameEs,
          jurisdictionName: gathered.projectContext.jurisdictionName,
          reportingCurrency: gathered.projectContext.reportingCurrency,
        },
        location: gathered.location,
        marketStudy: gathered.marketStudy,
        capacity: gathered.capacity,
        layout,
        fitout: gathered.fitout,
        opex: gathered.opex,
        financialProjection: gathered.financialProjection,
        permits,
        assumptions: gathered.assumptions,
        disclaimer,
      };

      const pdfBuffer = await renderReportPdf(renderInput);
      const storageKey = storageKeyFor(projectId, reportId);
      await this.storage.save(storageKey, pdfBuffer);

      const financialProjectionId = gathered.financialProjection.available ? gathered.financialProjection.data.id : null;
      await withUserSession(userId, (client) =>
        markReady(client, reportId, {
          storageKey,
          disclaimerDocumentId: disclaimer.id,
          engineVersion: ENGINE_VERSION,
          financialProjectionId,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error, projectId, reportId }, "report render job failed");
      await withUserSession(userId, (client) => markFailed(client, reportId, message)).catch((markError: unknown) => {
        logger.error({ err: markError, projectId, reportId }, "failed to mark report as failed after a render error");
      });
    }
  }

  /** Converts a cross-module service call's success/thrown-exception into a `ReportSection` — see this class's own doc comment on which sections gracefully degrade. */
  private async readSection<T>(fn: () => Promise<T>): Promise<ReportSection<T>> {
    try {
      return { available: true, data: await fn() };
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
