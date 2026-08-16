/**
 * B-13 (Module 4, layout). The zone vocabulary this screen offers.
 *
 * These are LABELS ONLY — no zone carries a suggested share. That absence is
 * the point: `packages/db/migrations/1785550000000_seed-layout-parameters.sql`
 * seeds zero `content.layout_template` rows because no standards body
 * publishes zone-to-zone area proportions for these business types, and
 * `packages/calc/src/layout.ts` refuses to invent one. A preset percentage
 * here would reintroduce exactly the fabricated figure both of those files
 * declined to write. Every zone therefore starts at 0% and the split is
 * entirely user-entered (provenance 'usuario').
 *
 * The taxonomy itself is a UI affordance, not cited content: it exists so the
 * user has somewhere to type rather than having to name every zone from
 * scratch. Zones can be added and removed freely.
 */

export interface ZonePreset {
  slug: string;
  label: string;
}

/**
 * Which zone each seeded `domain='layout'` density describes. The key is
 * `content.parameter_table.slug` as it arrives in `densityParameters`; the
 * value MUST be the slug the allocation uses, because
 * `checkLayoutZonePlausibility` matches a check to an allocation by exact
 * slug and throws when it matches nothing.
 */
export const ZONE_SLUG_BY_DENSITY_PARAMETER: Record<string, string | undefined> = {
  layout_m2_por_ocupante_almacen: "almacen",
  layout_m2_por_ocupante_cocina: "cocina",
};

const ALMACEN: ZonePreset = { slug: "almacen", label: "Almacén / trastienda" };
const BANOS: ZonePreset = { slug: "banos", label: "Baños" };

const PRESETS_BY_BUSINESS_TYPE: Record<string, ZonePreset[] | undefined> = {
  restaurante: [
    { slug: "comedor", label: "Comedor / salón" },
    { slug: "cocina", label: "Cocina" },
    { slug: "barra", label: "Barra" },
    ALMACEN,
    BANOS,
  ],
  colmado: [
    { slug: "venta", label: "Área de venta" },
    { slug: "mostrador", label: "Mostrador / caja" },
    ALMACEN,
    BANOS,
  ],
  minimarket: [
    { slug: "venta", label: "Área de venta" },
    { slug: "cajas", label: "Cajas" },
    ALMACEN,
    BANOS,
  ],
  ferreteria: [
    { slug: "venta", label: "Área de venta / exhibición" },
    { slug: "mostrador", label: "Mostrador / despacho" },
    ALMACEN,
    BANOS,
  ],
  salon: [
    { slug: "estaciones", label: "Estaciones de trabajo" },
    { slug: "lavado", label: "Área de lavado" },
    { slug: "espera", label: "Recepción / espera" },
    { slug: "insumos", label: "Almacén de insumos" },
    BANOS,
  ],
};

const GENERIC_PRESET: ZonePreset[] = [
  { slug: "principal", label: "Área principal" },
  ALMACEN,
  BANOS,
];

/**
 * The starting zone list for a business type, guaranteed to contain a zone for
 * every density the API resolved — a resolved density whose zone was missing
 * would silently never be compared against anything.
 */
export function presetZonesFor(businessTypeSlug: string, densityParameterSlugs: readonly string[]): ZonePreset[] {
  const zones = [...(PRESETS_BY_BUSINESS_TYPE[businessTypeSlug] ?? GENERIC_PRESET)];
  for (const parameterSlug of densityParameterSlugs) {
    const zoneSlug = ZONE_SLUG_BY_DENSITY_PARAMETER[parameterSlug];
    if (zoneSlug !== undefined && !zones.some((z) => z.slug === zoneSlug)) {
      zones.push({ slug: zoneSlug, label: zoneSlug });
    }
  }
  return zones;
}

/** Turns a user-typed zone name into a slug the allocation engine accepts. */
export function slugifyZoneName(name: string, fallbackIndex: number): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : `zona-${String(fallbackIndex)}`;
}
