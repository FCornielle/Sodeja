import { Controller, Get } from "@nestjs/common";
import type { BusinessTypeCatalogEntry } from "@sodeja/schemas";
import { CatalogService } from "./catalog.service.js";

/**
 * Module 5 (business simulator catalog). Read-only, reference content only —
 * see catalog.service.ts for why no `x-user-id` / RLS session is involved.
 */
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("business-types")
  async listBusinessTypes(): Promise<BusinessTypeCatalogEntry[]> {
    return this.catalogService.listBusinessTypes();
  }
}
