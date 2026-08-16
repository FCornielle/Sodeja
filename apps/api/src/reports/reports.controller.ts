import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res, StreamableFile } from "@nestjs/common";
import type { Response } from "express";
import { CreateReportRequestSchema, type CreateReportRequest, type Report } from "@sodeja/schemas";
import { CurrentUserId } from "../common/current-user-id.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ReportsService } from "./reports.service.js";

/**
 * B-19 (Module 13, PDF export) — `reports` module. See
 * apps/api/README.md's "B-19 contract" for the full write-up: which
 * prerequisite is hard-blocking (`409`, confirmed area only) versus which
 * sections gracefully degrade inside the rendered document, the in-memory
 * queue this MVP slice uses instead of Redis/BullMQ, and why
 * `/download` is a direct authenticated endpoint rather than a real
 * signed URL.
 */
@Controller("projects")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * `202` — the request never blocks on rendering (services/pdf-worker/
   * README.md: "the request path never blocks on Chromium"). Body:
   * `{ tier? }`, default `'resumen_analisis'`. `400` if `tier ===
   * 'plan_negocio'` (not available until B-26). `409` if the project's area
   * is not confirmed yet (B-7a gate).
   */
  @Post(":id/reports")
  @HttpCode(202)
  async createReport(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodValidationPipe(CreateReportRequestSchema)) body: CreateReportRequest,
  ): Promise<Report> {
    return this.reportsService.createReport(userId, projectId, body);
  }

  /** Status polling — the full list, newest first (UX spec Secondary Flow C: "the report appears in a list"). */
  @Get(":id/reports")
  async listReports(@CurrentUserId() userId: string, @Param("id", new ParseUUIDPipe()) projectId: string): Promise<Report[]> {
    return this.reportsService.listReports(userId, projectId);
  }

  /** Status polling for one report. `404` if it does not exist or is not the caller's. */
  @Get(":id/reports/:reportId")
  async getReport(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
    @Param("reportId", new ParseUUIDPipe()) reportId: string,
  ): Promise<Report> {
    return this.reportsService.getReport(userId, projectId, reportId);
  }

  /**
   * `404` if the report does not exist or is not the caller's; `409` if it
   * exists but `status !== 'ready'`. See services/pdf-worker/src/storage.ts's
   * header for why this is a direct authenticated download rather than a
   * real signed URL — a simplification appropriate to local filesystem
   * storage, not a security feature.
   */
  @Get(":id/reports/:reportId/download")
  async downloadReport(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
    @Param("reportId", new ParseUUIDPipe()) reportId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { filename, data } = await this.reportsService.downloadReport(userId, projectId, reportId);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
    return new StreamableFile(data);
  }
}
