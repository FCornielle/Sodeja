import type { Citation } from "@sodeja/schemas";
import type { CitationRow } from "./types.js";

/**
 * `content.citation`'s date columns are Postgres `date` (YYYY-MM-DD);
 * `@sodeja/schemas`'s `CitationSchema` requires full ISO 8601 datetimes
 * (`z.string().datetime()`). This is the one place that conversion happens,
 * so every citation this package emits already satisfies the shared schema.
 */
function toIsoDateTime(isoDate: string): string {
  return `${isoDate}T00:00:00.000Z`;
}

export class UnverifiedCitationError extends Error {
  constructor(citationId: number) {
    super(
      `Citation ${citationId} is not verified (is_verified = false) and must not be published ` +
        `(specs/db/schema.sql content.citation, SODEJA_RISKS.md T3)`,
    );
    this.name = "UnverifiedCitationError";
  }
}

/**
 * Maps a `content.citation` row to the shared `Citation` shape every
 * user-facing result carries. Throws on an unverified citation rather than
 * silently emitting one: an unsourced or unconfirmed figure must never reach
 * a result the UI renders (risk T3, and see SODEJA_DATA_SOURCES.md's several
 * "do not hardcode" / "still low-confidence" conflicts).
 */
export function toCitation(row: CitationRow): Citation {
  if (!row.isVerified) {
    throw new UnverifiedCitationError(row.id);
  }
  return {
    sourceName: row.sourceName,
    sourceDocument: row.articleRef
      ? `${row.documentTitle} (${row.articleRef})`
      : row.documentTitle,
    ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
    ...(row.articleRef ? { article: row.articleRef } : {}),
    retrievedAt: toIsoDateTime(row.retrievedOn),
    ...(row.publishedOn ? { effectiveDate: toIsoDateTime(row.publishedOn) } : {}),
  };
}
