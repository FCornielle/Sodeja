import { Module } from "@nestjs/common";
import { CapacityModule } from "./capacity/capacity.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { CostsModule } from "./costs/costs.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { ProvidersModule } from "./providers/providers.module.js";

/**
 * apps/api/README.md documents 13 eventual NestJS modules (auth, geo, ...);
 * each lands with the backlog item that needs it. B-3 added `providers`;
 * B-11/B-11a added `catalog` and `projects`; B-12 added `capacity`; B-14
 * adds `costs` (Modules 9+10 — fit-out now, opex/B-15 lands in the same
 * module next).
 */
@Module({
  imports: [ProvidersModule, CatalogModule, ProjectsModule, CapacityModule, CostsModule],
})
export class AppModule {}
