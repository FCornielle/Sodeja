import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CapacityEstimateRequestSchema, type CapacityEstimate, type CapacityEstimateRequest } from "@sodeja/schemas";
import { CurrentUserId } from "../common/current-user-id.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { CapacityService } from "./capacity.service.js";

/**
 * B-12 (Module 6, capacity). `POST /projects/:id/capacity-estimate` computes
 * AND persists a new `app.capacity_estimate` row (no separate GET — call
 * again to recompute; matches how the rest of this API always reads/writes
 * fresh rather than caching client-side). `409` if the project's area is
 * not confirmed yet (B-7a gate) or has no business type set. See
 * capacity.service.ts for the computation itself — no business math lives
 * here (apps/api/README.md "No business calculation in a controller or
 * service").
 */
@Controller("projects")
export class CapacityController {
  constructor(private readonly capacityService: CapacityService) {}

  @Post(":id/capacity-estimate")
  async computeCapacityEstimate(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodValidationPipe(CapacityEstimateRequestSchema)) body: CapacityEstimateRequest,
  ): Promise<CapacityEstimate> {
    return this.capacityService.computeCapacityEstimate(userId, projectId, body);
  }
}
