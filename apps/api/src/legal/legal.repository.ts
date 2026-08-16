import type { QueryClient } from "@sodeja/rules";
import type { LegalDocument, LegalDocumentKind } from "@sodeja/schemas";

interface RawLegalDocumentRow {
  id: string;
  kind: LegalDocumentKind;
  version: string;
  locale: string;
  body_md: string;
  effective_from: Date;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * `app.legal_document` has no RLS enabled (specs/db/schema.sql section 7) —
 * reference content, not user-owned data, the same posture
 * `catalog.service.ts` documents for `content.business_type`. The "current"
 * document for a (kind, locale) pair is the one with the latest
 * `effective_from`; `UNIQUE (kind, version, locale)` lets multiple versions
 * coexist, and this is the resolution rule for which one is "current".
 */
export async function fetchCurrentLegalDocument(
  client: QueryClient,
  kind: LegalDocumentKind,
  locale: string,
): Promise<LegalDocument | null> {
  const { rows } = await client.query<RawLegalDocumentRow>(
    `SELECT id, kind, version, locale, body_md, effective_from
       FROM app.legal_document
      WHERE kind = $1 AND locale = $2
      ORDER BY effective_from DESC
      LIMIT 1`,
    [kind, locale],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    kind: row.kind,
    version: row.version,
    locale: row.locale,
    bodyMd: row.body_md,
    effectiveFrom: toIsoDate(row.effective_from),
  };
}
