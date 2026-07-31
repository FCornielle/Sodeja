import { describe, expect, it } from "vitest";
import { toCitation, UnverifiedCitationError } from "./citation.js";
import type { CitationRow } from "./types.js";

const verified: CitationRow = {
  id: 1,
  sourceName: "Comité Nacional de Salarios (CNS)",
  documentTitle: "Resolución CNS-01-2025",
  articleRef: null,
  sourceUrl: null,
  publishedOn: "2026-02-01",
  retrievedOn: "2026-07-25",
  isVerified: true,
  verificationNote: null,
};

describe("toCitation", () => {
  it("maps a verified citation row into the shared Citation shape with ISO datetimes", () => {
    const citation = toCitation(verified);
    expect(citation.sourceDocument).toBe("Resolución CNS-01-2025");
    expect(citation.retrievedAt).toBe("2026-07-25T00:00:00.000Z");
    expect(citation.effectiveDate).toBe("2026-02-01T00:00:00.000Z");
  });

  it("folds the article reference into the source document when present", () => {
    const withArticle = { ...verified, articleRef: "Art. 12" };
    expect(toCitation(withArticle).sourceDocument).toBe("Resolución CNS-01-2025 (Art. 12)");
  });

  it("refuses to emit a citation that is not verified", () => {
    const unverified = { ...verified, isVerified: false };
    expect(() => toCitation(unverified)).toThrow(UnverifiedCitationError);
  });
});
