import { Module } from "@nestjs/common";
import { FilesystemReportStorage, InMemoryReportQueue, type ReportQueue, type ReportStorage } from "@sodeja/pdf-worker";
import { LayoutModule } from "../layout/layout.module.js";
import { LegalModule } from "../legal/legal.module.js";
import { PermitsModule } from "../permits/permits.module.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";
import { REPORT_QUEUE, REPORT_STORAGE } from "./tokens.js";

/**
 * `useFactory` (not a bare class provider) for both adapters so the env var
 * driving storage location is read fresh each time a `TestingModule`
 * compiles — same "read env in a constructor body, not a field
 * initializer" discipline `providers.service.ts` documents, applied one
 * level up since these are plain classes rather than NestJS injectables.
 */
@Module({
  imports: [LayoutModule, PermitsModule, LegalModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    {
      provide: REPORT_QUEUE,
      useFactory: (): ReportQueue => new InMemoryReportQueue(),
    },
    {
      provide: REPORT_STORAGE,
      useFactory: (): ReportStorage => new FilesystemReportStorage(process.env.REPORTS_STORAGE_DIR ?? "./data/reports"),
    },
  ],
})
export class ReportsModule {}
