import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { FitoutEstimateRequestSchema, type FitoutEstimate, type FitoutEstimateRequest } from "@sodeja/schemas";
import { CurrentUserId } from "../common/current-user-id.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { FitoutService } from "./fitout.service.js";

/**
 * B-14 (Module 9, fit-out) — one `costs` NestJS module per
 * apps/api/README.md's module table (B-15/opex lands in this same module
 * next). `POST` computes AND persists a new row (no separate `GET`; same
 * posture as `capacity`). `409` if the project's area is not confirmed yet
 * (B-7a gate, `apps/api/src/common/area-gate.ts`). No business math lives
 * here — see fitout.service.ts.
 */
@Controller("projects")
export class CostsController {
  constructor(private readonly fitoutService: FitoutService) {}

  @Post(":id/fitout-estimate")
  async computeFitoutEstimate(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodValidationPipe(FitoutEstimateRequestSchema)) body: FitoutEstimateRequest,
  ): Promise<FitoutEstimate> {
    return this.fitoutService.computeFitoutEstimate(userId, projectId, body);
  }
}
