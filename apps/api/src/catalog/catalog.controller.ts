import { Controller, Get } from "@nestjs/common";
import type { BusinessTypeCatalogEntry, Jurisdiction } from "@sodeja/schemas";
import { CatalogService } from "./catalog.service.js";

/**
 * Module 5 (business simulator catalog) + the jurisdiction catalog. Read-only,
 * reference content only — see catalog.service.ts for why no `x-user-id` /
 * RLS session is involved.
 */
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("business-types")
  async listBusinessTypes(): Promise<BusinessTypeCatalogEntry[]> {
    return this.catalogService.listBusinessTypes();
  }

  /** The 3 seeded MVP launch metro areas — see `listLaunchJurisdictions`'s own doc comment. */
  @Get("jurisdictions")
  async listJurisdictions(): Promise<Jurisdiction[]> {
    return this.catalogService.listLaunchJurisdictions();
  }
}
