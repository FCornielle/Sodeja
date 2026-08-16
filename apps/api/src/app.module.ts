import { Module } from "@nestjs/common";
import { CapacityModule } from "./capacity/capacity.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { CostsModule } from "./costs/costs.module.js";
import { FinanceModule } from "./finance/finance.module.js";
import { GeoModule } from "./geo/geo.module.js";
import { LayoutModule } from "./layout/layout.module.js";
import { LegalModule } from "./legal/legal.module.js";
import { MarketStudyModule } from "./market-study/market-study.module.js";
import { PermitsModule } from "./permits/permits.module.js";
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
 * full footprint-confirm module is B-8, not built here); B-9 adds
 * `market-study` (Module 1 — population + competition + a demand index,
 * gated behind `geo.data_coverage_cell`'s real coverage-tier signal); B-13
 * adds `layout` (Module 4 — a read-only parameter endpoint, since the zone
 * allocation itself runs client-side in `@sodeja/calc`); B-18 adds `permits`
 * (Module 12 — a read-only checklist over B-10's rule interpreter; the
 * README's placeholder name for it was `rules`); B-20 adds `legal` (a
 * read-only slice: just the current disclaimer document, see the "B-20
 * contract" README section for what is deliberately not built).
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
    LayoutModule,
    MarketStudyModule,
    PermitsModule,
    LegalModule,
  ],
})
export class AppModule {}
