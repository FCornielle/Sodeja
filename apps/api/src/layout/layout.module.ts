import { Module } from "@nestjs/common";
import { LayoutController } from "./layout.controller.js";
import { LayoutService } from "./layout.service.js";

@Module({
  controllers: [LayoutController],
  providers: [LayoutService],
})
export class LayoutModule {}
