import { z } from "zod";

/** Mirrors `app.legal_document.kind`'s CHECK (specs/db/schema.sql). */
export const LegalDocumentKindSchema = z.enum(["tos", "privacy", "disclaimer"]);
export type LegalDocumentKind = z.infer<typeof LegalDocumentKindSchema>;

/**
 * `GET /legal/documents/:kind/current` — the wire contract for one
 * `app.legal_document` row. B-20's minimal slice only ever seeds `kind =
 * 'disclaimer'` (packages/db/migrations/1785570000000_seed-disclaimer-legal-document.sql);
 * `tos`/`privacy` are valid `kind` values in the schema but have no seeded
 * content yet — that needs the login flow (UX spec Step 0) this MVP slice
 * does not build (see apps/api/README.md's "B-20 contract").
 */
export const LegalDocumentSchema = z.object({
  id: z.number().int(),
  kind: LegalDocumentKindSchema,
  version: z.string().min(1),
  locale: z.string().min(1),
  /** Full Markdown body — the client/PDF renders this verbatim, never a summary. */
  bodyMd: z.string().min(1),
  effectiveFrom: z.string(),
});
export type LegalDocument = z.infer<typeof LegalDocumentSchema>;
