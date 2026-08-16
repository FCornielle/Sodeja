import { Module } from "@nestjs/common";
import { LegalController } from "./legal.controller.js";
import { LegalService } from "./legal.service.js";

@Module({
  controllers: [LegalController],
  providers: [LegalService],
  // Exported so `reports` (B-19) can inject LegalService directly rather
  // than duplicating the "current disclaimer" query.
  exports: [LegalService],
})
export class LegalModule {}
