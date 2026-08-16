import { Module } from "@nestjs/common";
import { PermitsController } from "./permits.controller.js";
import { PermitsService } from "./permits.service.js";

@Module({
  controllers: [PermitsController],
  providers: [PermitsService],
})
export class PermitsModule {}
