import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { extractAdminAreaRows } from "./ochaAdminAreas.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

describe("extractAdminAreaRows", () => {
  it("extracts and maps all four ADM levels from a real-shaped COD-AB zip", () => {
    const zipBuffer = readFileSync(join(FIXTURES_DIR, "ocha-admin-boundaries-sample.zip"));
    const rows = extractAdminAreaRows(zipBuffer, "2026-01-01");

    expect(rows).toHaveLength(1 + 1 + 1 + 3); // pais + provincia + municipio + 3 secciones
    expect(rows.filter((r) => r.level === "pais")).toHaveLength(1);
    expect(rows.filter((r) => r.level === "provincia")).toHaveLength(1);
    expect(rows.filter((r) => r.level === "municipio")).toHaveLength(1);
    expect(rows.filter((r) => r.level === "seccion")).toHaveLength(3);

    // Full chain resolves: pais <- provincia <- municipio <- seccion.
    const pais = rows.find((r) => r.level === "pais")!;
    const provincia = rows.find((r) => r.level === "provincia")!;
    const municipio = rows.find((r) => r.level === "municipio")!;
    expect(provincia.parentCode).toBe(pais.code);
    expect(municipio.parentCode).toBe(provincia.code);
    for (const seccion of rows.filter((r) => r.level === "seccion")) {
      expect(seccion.parentCode).toBe(municipio.code);
    }
  });

  it("throws a clear error if an expected ADM level file is missing from the zip", () => {
    // An empty AdmZip archive has none of the four expected entries.
    // Constructed inline rather than via a fixture file to keep the "bad
    // input" case obviously synthetic.
    const empty = new AdmZip();
    expect(() => extractAdminAreaRows(empty.toBuffer(), "2026-01-01")).toThrow(
      /dom_admin0.geojson/,
    );
  });
});
