import type { GeoJsonFeature, PolygonalGeometry } from "../lib/geojson.js";

export type AdminLevel = "pais" | "provincia" | "municipio" | "seccion" | "barrio";

export interface AdminAreaRow {
  level: AdminLevel;
  code: string;
  parentCode: string | null;
  name: string;
  geometry: PolygonalGeometry;
  source: string;
  sourceLicense: string;
  sourceVintage: string; // ISO date (YYYY-MM-DD)
}

export const OCHA_SOURCE = "ocha_cod_ab";
export const OCHA_LICENSE = "CC BY-IGO";

/**
 * OCHA's Common Operational Dataset – Administrative Boundaries (COD-AB) for
 * the Dominican Republic, per docs/SODEJA_DATA_SOURCES.md, publishes four
 * usable polygon levels: ADM0 (country, 1 feature), ADM2 (province, 32),
 * ADM3 (municipio, 155) and ADM4 (distrito municipal, 386 — the finest level
 * OCHA publishes). ADM1 ("región de planificación", 10 features) is a
 * planning-region grouping with no equivalent in geo.admin_area's
 * pais/provincia/municipio/seccion/barrio hierarchy, so it is deliberately
 * NOT loaded; provincia (ADM2) links straight to pais (ADM0) instead.
 *
 * Level mapping (documented per B-6's brief, since OCHA's ADM levels don't
 * line up 1:1 with the schema's five-level enum):
 *   ADM0 -> 'pais'       ADM2 -> 'provincia'   ADM3 -> 'municipio'
 *   ADM4 -> 'seccion'    (closest available; OCHA's finest published level,
 *     "distrito municipal", is coarser than DR's true sección/barrio units —
 *     see SODEJA_DATA_SOURCES.md's "ONE barrio/block tables" row. No public
 *     geometry exists below ADM4, so 'barrio' is never populated by this job.)
 */
export const OCHA_LEVEL_MAP = {
  0: "pais",
  2: "provincia",
  3: "municipio",
  4: "seccion",
} as const satisfies Record<number, AdminLevel>;

export type OchaAdmLevel = keyof typeof OCHA_LEVEL_MAP;

const PARENT_ADM_LEVEL: Record<OchaAdmLevel, number | null> = {
  0: null,
  2: 0, // provincia's parent is pais, skipping the region (ADM1) tier
  3: 2, // municipio's parent is provincia
  4: 3, // seccion (ADM4)'s parent is municipio
};

/**
 * Picks the Spanish-language name field. OCHA's `lang`/`lang1` properties
 * indicate which of the two name columns for a given ADM level is Spanish —
 * it is `adm{N}_name` when `lang === "es"` (true for ADM1-ADM4) and
 * `adm{N}_name1` when `lang1 === "es"` (true for ADM0, whose primary `name`
 * field is English). Falls back to the primary name field if neither matches
 * so a row is never silently dropped for a naming-convention quirk.
 */
function pickSpanishName(props: Record<string, unknown>, admLevel: OchaAdmLevel): string {
  const primary = props[`adm${admLevel}_name`];
  const secondary = props[`adm${admLevel}_name1`];
  if (props.lang === "es" && typeof primary === "string") return primary;
  if (props.lang1 === "es" && typeof secondary === "string") return secondary;
  return typeof primary === "string" ? primary : String(secondary ?? "");
}

export function mapOchaFeature(
  feature: GeoJsonFeature,
  admLevel: OchaAdmLevel,
  sourceVintage: string,
): AdminAreaRow {
  const props = feature.properties;
  const code = props[`adm${admLevel}_pcode`];
  if (typeof code !== "string" || code.length === 0) {
    throw new Error(`OCHA feature at ADM${admLevel} is missing adm${admLevel}_pcode`);
  }

  const parentAdmLevel = PARENT_ADM_LEVEL[admLevel];
  const parentCode =
    parentAdmLevel === null ? null : ((props[`adm${parentAdmLevel}_pcode`] as string) ?? null);

  const validOn = typeof props.valid_on === "string" ? props.valid_on : sourceVintage;

  return {
    level: OCHA_LEVEL_MAP[admLevel],
    code,
    parentCode,
    name: pickSpanishName(props, admLevel),
    geometry: feature.geometry,
    source: OCHA_SOURCE,
    sourceLicense: OCHA_LICENSE,
    sourceVintage: validOn,
  };
}
