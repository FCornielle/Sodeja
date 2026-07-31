import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { type BatchColumn, insertBatches } from "./batchInsert.js";

interface Row {
  id: number;
  name: string;
}

const COLUMNS: readonly BatchColumn<Row>[] = [
  { name: "id", expr: (i) => `$${i}`, value: (r) => r.id },
  { name: "name", expr: (i) => `$${i}`, value: (r) => r.name },
];

function fakeClient() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as PoolClient;
  return { client, calls };
}

describe("insertBatches", () => {
  it("does nothing for an empty row set", async () => {
    const { client, calls } = fakeClient();
    const inserted = await insertBatches(client, "t", COLUMNS, []);
    expect(inserted).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("builds one multi-row INSERT for rows within a single batch", async () => {
    const { client, calls } = fakeClient();
    const rows: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
    const inserted = await insertBatches(client, "t", COLUMNS, rows, 500);

    expect(inserted).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toBe("INSERT INTO t (id, name) VALUES ($1, $2), ($3, $4)");
    expect(calls[0]!.params).toEqual([1, "a", 2, "b"]);
  });

  it("splits rows across multiple batches when they exceed batchSize", async () => {
    const { client, calls } = fakeClient();
    const rows: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }];
    const inserted = await insertBatches(client, "t", COLUMNS, rows, 2);

    expect(inserted).toBe(3);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.params).toEqual([1, "a", 2, "b"]);
    expect(calls[1]!.params).toEqual([3, "c"]);
  });

  it("supports a non-parameter column expression (e.g. a PostGIS constructor)", async () => {
    const { client, calls } = fakeClient();
    const geomColumns: readonly BatchColumn<{ geojson: string }>[] = [
      { name: "geom", expr: (i) => `ST_SetSRID(ST_GeomFromGeoJSON($${i}), 4326)`, value: (r) => r.geojson },
    ];
    await insertBatches(client, "geo.t", geomColumns, [{ geojson: "{}" }]);
    expect(calls[0]!.sql).toBe(
      "INSERT INTO geo.t (geom) VALUES (ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))",
    );
  });
});
