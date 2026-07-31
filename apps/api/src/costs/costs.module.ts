import { Module } from "@nestjs/common";
import { CostsController } from "./costs.controller.js";
import { FitoutService } from "./fitout.service.js";
import { OpexService } from "./opex.service.js";

@Module({
  controllers: [CostsController],
  providers: [FitoutService, OpexService],
})
export class CostsModule {}
