import type { Citation } from "@sodeja/schemas";

/**
 * The one way this app renders a `Citation`. No screen had rendered one yet
 * (B-18 is the first), so this establishes the convention rather than matching
 * an existing one — every later screen that shows a cited figure should reuse
 * it instead of formatting citations inline.
 *
 * Order is source → document → article → retrieval date, because that is the
 * order someone re-verifying the claim needs it in: who published it, which
 * text, where in that text, and how stale our copy is. `sourceDocument` is the
 * only required field (`CitationSchema`), so every other part is conditional
 * and none of them may be faked with a placeholder — an absent source name is
 * rendered as absent, not as "Desconocido".
 *
 * `article` is stored with its own prefix already in it ("Art. 5 (plazo);
 * Arts. 2, 3, 7 y 12"), so it is printed verbatim and never re-prefixed here.
 */
export function CitationLine({ citation }: { citation: Citation }) {
  const document =
    citation.sourceUrl !== undefined ? (
      <a
        href={citation.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-neutral-400 underline-offset-2 hover:text-neutral-900"
      >
        {citation.sourceDocument}
      </a>
    ) : (
      citation.sourceDocument
    );

  return (
    <p className="text-xs leading-relaxed text-neutral-500">
      <span className="font-medium text-neutral-600">Fuente: </span>
      {citation.sourceName !== undefined && <>{citation.sourceName} — </>}
      <cite className="not-italic">{document}</cite>
      {citation.article !== undefined && <>, {citation.article}</>}
      {citation.effectiveDate !== undefined && <> · en vigor desde {formatDate(citation.effectiveDate)}</>}
      {" · "}
      consultado el {formatDate(citation.retrievedAt)}
    </p>
  );
}

/**
 * Accepts both shapes the API sends: full ISO datetimes (`Citation`) and bare
 * `YYYY-MM-DD` calendar dates (`PermitChecklistItem.effectiveFrom`). The bare
 * ones are split by hand rather than passed through `new Date`, which would
 * read them as UTC midnight and render the day before in any DR-local
 * (UTC-4) browser.
 */
export function formatDate(value: string): string {
  const [datePart] = value.split("T");
  const [year, month, day] = (datePart ?? "").split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString("es-DO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
