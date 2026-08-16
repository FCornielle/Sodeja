import { Injectable, NotFoundException } from "@nestjs/common";
import { withServiceSession } from "@sodeja/db";
import type { LegalDocument, LegalDocumentKind } from "@sodeja/schemas";
import { fetchCurrentLegalDocument } from "./legal.repository.js";

const DEFAULT_LOCALE = "es-DO";

/**
 * B-20's minimal slice: `legal` module, read-only reference content — same
 * RLS-disabled posture as `catalog` (see legal.repository.ts's doc
 * comment). Uses `withServiceSession`, not `withUserSession`: there is no
 * `x-user-id` to require for a document any authenticated (or, in a real
 * login-less MVP, ANY) caller may read.
 *
 * Exported for `reports` (B-19) to inject directly — the render job needs
 * the CURRENT disclaimer's full body to embed in every PDF, and "current
 * disclaimer" is exactly this method, not a duplicated query
 * (apps/api/README.md "Architectural rules": "Cross-module calls go through
 * service interfaces only").
 */
@Injectable()
export class LegalService {
  async getCurrentDocument(kind: LegalDocumentKind, locale: string = DEFAULT_LOCALE): Promise<LegalDocument> {
    return withServiceSession(async (client) => {
      const doc = await fetchCurrentLegalDocument(client, kind, locale);
      if (!doc) {
        throw new NotFoundException(`no '${kind}' legal document exists for locale '${locale}'`);
      }
      return doc;
    });
  }
}
