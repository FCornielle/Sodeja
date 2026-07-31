import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import {
  FitoutEstimateRequestSchema,
  OpexEstimateRequestSchema,
  type FitoutEstimate,
  type FitoutEstimateRequest,
  type OpexEstimate,
  type OpexEstimateRequest,
} from "@sodeja/schemas";
import { CurrentUserId } from "../common/current-user-id.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { FitoutService } from "./fitout.service.js";
import { OpexService } from "./opex.service.js";

/**
 * B-14 (Module 9, fit-out) + B-15 (Module 10, opex) — one `costs` NestJS
 * module per apps/api/README.md's module table. Each `POST` computes AND
 * persists a new row (no separate GET; same posture as `capacity`). Both
 * `409` if the project's area is not confirmed yet (B-7a gate,
 * `apps/api/src/common/area-gate.ts`). No business math lives here — see
 * fitout.service.ts / opex.service.ts.
 */
@Controller("projects")
export class CostsController {
  constructor(
    private readonly fitoutService: FitoutService,
    private readonly opexService: OpexService,
  ) {}

  @Post(":id/fitout-estimate")
  async computeFitoutEstimate(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodValidationPipe(FitoutEstimateRequestSchema)) body: FitoutEstimateRequest,
  ): Promise<FitoutEstimate> {
    return this.fitoutService.computeFitoutEstimate(userId, projectId, body);
  }

  @Post(":id/opex-estimate")
  async computeOpexEstimate(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodValidationPipe(OpexEstimateRequestSchema)) body: OpexEstimateRequest,
  ): Promise<OpexEstimate> {
    return this.opexService.computeOpexEstimate(userId, projectId, body);
  }
}
