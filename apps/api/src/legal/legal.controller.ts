import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { LegalDocumentKindSchema, type LegalDocument } from "@sodeja/schemas";
import { LegalService } from "./legal.service.js";

/**
 * B-20's minimal slice: `GET /legal/documents/:kind/current?locale=` —
 * read-only, no auth required (reference content, same posture as `GET
 * /business-types`). See legal.service.ts and apps/api/README.md's "B-20
 * contract" for what is deliberately NOT built here (ToS acceptance
 * tracking, Ley 172-13 consent, export/delete — all need the login step,
 * UX spec Step 0, which does not exist yet).
 *
 * `404` if no document of that `kind`/`locale` has been seeded — currently
 * only `kind=disclaimer, locale=es-DO` exists
 * (packages/db/migrations/1785570000000_seed-disclaimer-legal-document.sql).
 * `400` if `:kind` is not one of `tos`/`privacy`/`disclaimer`.
 */
@Controller("legal")
export class LegalController {
  constructor(private readonly legalService: LegalService) {}

  @Get("documents/:kind/current")
  async getCurrent(@Param("kind") kindParam: string, @Query("locale") locale?: string): Promise<LegalDocument> {
    const parsed = LegalDocumentKindSchema.safeParse(kindParam);
    if (!parsed.success) {
      throw new BadRequestException("kind must be one of: tos, privacy, disclaimer");
    }
    return this.legalService.getCurrentDocument(parsed.data, locale);
  }
}
