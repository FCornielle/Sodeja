import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import {
  FinancialProjectionRequestSchema,
  type FinancialProjection,
  type FinancialProjectionRequest,
} from "@sodeja/schemas";
import { CurrentUserId } from "../common/current-user-id.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { FinanceService } from "./finance.service.js";

/**
 * B-17 (Module 7, financial projection) — the integration point
 * (apps/api/README.md). `POST /projects/:id/financial-projection` computes
 * AND persists a new `app.financial_projection` row (no separate GET; same
 * posture as `capacity`/`costs` — call again to recompute). `409` with a
 * `missing` checklist when any of the four hard prerequisites (confirmed
 * area, capacity_estimate, fitout_estimate, opex_estimate) is absent —
 * never a silent default (UX spec Step 7 "Prerequisites missing"). No
 * business math lives here — see finance.service.ts.
 */
@Controller("projects")
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Post(":id/financial-projection")
  async computeFinancialProjection(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodValidationPipe(FinancialProjectionRequestSchema)) body: FinancialProjectionRequest,
  ): Promise<FinancialProjection> {
    return this.financeService.computeFinancialProjection(userId, projectId, body);
  }
}
