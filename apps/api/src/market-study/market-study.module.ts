import { Module } from "@nestjs/common";
import { MarketStudyController } from "./market-study.controller.js";
import { MarketStudyService } from "./market-study.service.js";

@Module({
  controllers: [MarketStudyController],
  providers: [MarketStudyService],
})
export class MarketStudyModule {}
