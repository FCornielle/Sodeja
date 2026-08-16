import type { ReactElement } from "react";

/**
 * A deliberately minimal, dependency-free Markdown-to-JSX converter — just
 * enough to render `app.legal_document.body_md` (headings, paragraphs, and
 * `-` bullet lists; see the B-20 seed migration for the exact Markdown it
 * writes). NOT a general Markdown renderer: no links, emphasis, tables, or
 * nested lists. Adding a real Markdown library is a reasonable future step
 * if `legal_document` content grows richer, but this document's own content
 * never needs more than the three block types below, and pulling in a
 * dependency for three block types would be the wrong trade for a
 * PDF-rendering pipeline that must stay simple and auditable.
 */
export function renderMarkdownLite(bodyMd: string): ReactElement[] {
  const lines = bodyMd.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactElement[] = [];
  let listItems: string[] = [];
  let key = 0;

  function flushList(): void {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`list-${key++}`}>
        {listItems.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>,
    );
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("- ")) {
      listItems.push(line.slice(2));
      continue;
    }
    flushList();
    if (line.length === 0) continue;
    if (line.startsWith("## ")) {
      blocks.push(<h3 key={`h-${key++}`}>{line.slice(3)}</h3>);
    } else if (line.startsWith("# ")) {
      blocks.push(<h2 key={`h-${key++}`}>{line.slice(2)}</h2>);
    } else {
      blocks.push(<p key={`p-${key++}`}>{stripBold(line)}</p>);
    }
  }
  flushList();
  return blocks;
}

/** Strips `**bold**` markers to plain text — bold emphasis isn't worth a real inline parser for this content, but leaving the literal asterisks in a legal notice would look broken. */
function stripBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}
