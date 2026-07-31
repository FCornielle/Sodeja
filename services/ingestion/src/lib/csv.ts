/**
 * Minimal RFC-4180-ish CSV parser. Written by hand rather than pulling in a
 * dependency because the only two consumers (Open Buildings V3 export, the
 * census extract CSV — see jobs/ingestCensusPopulation.ts) both need exactly
 * one non-trivial feature: a quoted field containing embedded commas. Open
 * Buildings' `geometry` column is WKT — "POLYGON((-70.1 18.4, -70.2 18.5))" —
 * which contains commas between coordinate pairs, so a naive `line.split(",")`
 * silently corrupts every row. This handles quoted fields, embedded commas,
 * and doubled-quote escaping ("" -> ") within a quoted field.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export interface CsvTable {
  header: string[];
  rows: Record<string, string>[];
}

/** Parses a full CSV document (header row + data rows) into keyed records. */
export function parseCsv(content: string): CsvTable {
  const lines = content.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { header: [], rows: [] };
  }
  const header = parseCsvLine(lines[0]!).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key] = values[index] ?? "";
    });
    return record;
  });
  return { header, rows };
}
