import { Module } from "@nestjs/common";
import { CapacityController } from "./capacity.controller.js";
import { CapacityService } from "./capacity.service.js";

@Module({
  controllers: [CapacityController],
  providers: [CapacityService],
})
export class CapacityModule {}
