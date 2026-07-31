import { Module } from "@nestjs/common";
import { CostsController } from "./costs.controller.js";
import { FitoutService } from "./fitout.service.js";

@Module({
  controllers: [CostsController],
  providers: [FitoutService],
})
export class CostsModule {}
