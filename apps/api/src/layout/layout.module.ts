import { Module } from "@nestjs/common";
import { LayoutController } from "./layout.controller.js";
import { LayoutService } from "./layout.service.js";

@Module({
  controllers: [LayoutController],
  providers: [LayoutService],
  // Exported so `reports` (B-19) can inject LayoutService directly — the
  // render job reads live layout parameters the same way this module's own
  // controller does, rather than duplicating the parameter-resolution query
  // (apps/api/README.md "Architectural rules").
  exports: [LayoutService],
})
export class LayoutModule {}
