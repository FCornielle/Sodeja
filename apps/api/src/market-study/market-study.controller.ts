import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import {
  AddManualCompetitorsRequestSchema,
  MarketStudyRequestSchema,
  type AddManualCompetitorsRequest,
  type MarketStudy,
  type MarketStudyRequest,
} from "@sodeja/schemas";
import { CurrentUserId } from "../common/current-user-id.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { MarketStudyService } from "./market-study.service.js";

/**
 * B-9 (Module 1, market study) — one `market-study` NestJS module per
 * apps/api/README.md's module table. `POST` computes AND persists (an
 * upsert, since `app.market_study` has one row per project — see
 * market-study.repository.ts), matching `capacity`/`costs`'s
 * compute-and-store posture. `409`s if the project's area is not confirmed
 * yet (B-7a gate). No business math lives here — see market-study.service.ts.
 */
@Controller("projects")
export class MarketStudyController {
  constructor(private readonly marketStudyService: MarketStudyService) {}

  @Post(":id/market-study")
  async computeMarketStudy(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
    @Query(new ZodValidationPipe(MarketStudyRequestSchema)) query: MarketStudyRequest,
  ): Promise<MarketStudy> {
    return this.marketStudyService.computeMarketStudy(userId, projectId, query);
  }

  @Patch(":id/market-study/manual-competitors")
  async addManualCompetitors(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodValidationPipe(AddManualCompetitorsRequestSchema)) body: AddManualCompetitorsRequest,
  ): Promise<MarketStudy> {
    return this.marketStudyService.addManualCompetitors(userId, projectId, body.delta);
  }
}
