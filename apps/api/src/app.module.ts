import { Module } from "@nestjs/common";
import { CapacityModule } from "./capacity/capacity.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { CostsModule } from "./costs/costs.module.js";
import { FinanceModule } from "./finance/finance.module.js";
import { GeoModule } from "./geo/geo.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { ProvidersModule } from "./providers/providers.module.js";

/**
 * apps/api/README.md documents 13 eventual NestJS modules (auth, geo, ...);
 * each lands with the backlog item that needs it. B-3 added `providers`;
 * B-11/B-11a added `catalog` and `projects`; B-12 added `capacity`; B-14
 * added `costs` (Modules 9+10, fit-out + opex); B-17 added `finance`
 * (Module 7 — the integration point that reads capacity/fitout/opex rather
 * than recomputing them); B-7 adds `geo` (read-only footprint lookup +
 * launch-area coverage — just enough to unblock the map UI's Step 1; the
 * full footprint-confirm module is B-8, not built here).
 */
@Module({
  imports: [
    ProvidersModule,
    CatalogModule,
    ProjectsModule,
    CapacityModule,
    CostsModule,
    FinanceModule,
    GeoModule,
  ],
})
export class AppModule {}
