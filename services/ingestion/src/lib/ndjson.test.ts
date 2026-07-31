import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readNdjson } from "./ndjson.js";

async function collect<T>(iterable: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("readNdjson", () => {
  it("parses one JSON value per line", async () => {
    const stream = Readable.from('{"a":1}\n{"a":2}\n');
    const rows = await collect(readNdjson<{ a: number }>(stream));
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("skips blank lines", async () => {
    const stream = Readable.from('{"a":1}\n\n\n{"a":2}\n');
    const rows = await collect(readNdjson<{ a: number }>(stream));
    expect(rows).toHaveLength(2);
  });

  it("parses real MS GlobalML-shaped feature lines", async () => {
    const line =
      '{"type": "Feature", "properties": { "height": -1.0, "confidence": -1.0},"geometry": {"type": "Polygon","coordinates": [[[-71.72,19.58],[-71.72,19.58],[-71.72,19.59],[-71.72,19.58]]]}}\n';
    const stream = Readable.from(line);
    const rows = await collect(readNdjson(stream));
    expect(rows).toHaveLength(1);
    expect((rows[0] as { type: string }).type).toBe("Feature");
  });
});
