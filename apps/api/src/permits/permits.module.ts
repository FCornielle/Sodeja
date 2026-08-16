import { Module } from "@nestjs/common";
import { PermitsController } from "./permits.controller.js";
import { PermitsService } from "./permits.service.js";

@Module({
  controllers: [PermitsController],
  providers: [PermitsService],
  // Exported so `reports` (B-19) can inject PermitsService directly — the
  // render job's permits section reuses the same `evaluatePermits` call this
  // module's own controller makes, rather than duplicating rule evaluation
  // (apps/api/README.md "Architectural rules").
  exports: [PermitsService],
})
export class PermitsModule {}
