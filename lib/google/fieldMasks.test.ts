import { describe, expect, it } from 'vitest';
import {
  MASK_ATMOSPHERE,
  MASK_COMPETITOR_COUNT_DEGRADED,
  MASK_ID_REFRESH,
  MASK_MARKET_CENSUS,
  MASK_SUBJECT_DETAIL,
  MASK_TIERS,
  NEARBY_SEARCH_PRICING,
  UNSUPPORTED_IN_DR,
  type PlacesTier,
} from './fieldMasks';

/**
 * Reparto de campos por tier, verificado contra la documentacion oficial de
 * Google (Place Data Fields). Es la fuente de verdad de estos tests.
 *
 * Cuando Google mueva un campo de tier, se actualiza AQUI y los tests dicen
 * que mascaras hay que revisar.
 */
const FIELD_TIER: Record<string, PlacesTier> = {
  // --- Essentials ---
  id: 'Essentials',
  name: 'Essentials',
  attributions: 'Essentials',
  photos: 'Essentials',
  addressComponents: 'Essentials',
  formattedAddress: 'Essentials',
  location: 'Essentials',
  plusCode: 'Essentials',
  shortFormattedAddress: 'Essentials',
  types: 'Essentials', // NO es Pro. Error frecuente.
  viewport: 'Essentials',

  // --- Pro ---
  businessStatus: 'Pro',
  displayName: 'Pro',
  googleMapsUri: 'Pro',
  openingDate: 'Pro',
  primaryType: 'Pro',
  primaryTypeDisplayName: 'Pro',
  pureServiceAreaBusiness: 'Pro',
  timeZone: 'Pro',
  utcOffsetMinutes: 'Pro',

  // --- Enterprise ---
  currentOpeningHours: 'Enterprise',
  regularOpeningHours: 'Enterprise',
  internationalPhoneNumber: 'Enterprise',
  nationalPhoneNumber: 'Enterprise',
  priceLevel: 'Enterprise',
  priceRange: 'Enterprise',
  rating: 'Enterprise',
  userRatingCount: 'Enterprise',
  websiteUri: 'Enterprise',

  // --- Enterprise + Atmosphere ---
  reviews: 'Enterprise + Atmosphere',
  reviewSummary: 'Enterprise + Atmosphere',
  editorialSummary: 'Enterprise + Atmosphere',
  generativeSummary: 'Enterprise + Atmosphere',
  neighborhoodSummary: 'Enterprise + Atmosphere',
  accessibilityOptions: 'Enterprise + Atmosphere',
  allowsDogs: 'Enterprise + Atmosphere',
  curbsidePickup: 'Enterprise + Atmosphere',
  delivery: 'Enterprise + Atmosphere',
  dineIn: 'Enterprise + Atmosphere',
  goodForChildren: 'Enterprise + Atmosphere',
  goodForGroups: 'Enterprise + Atmosphere',
  goodForWatchingSports: 'Enterprise + Atmosphere',
  liveMusic: 'Enterprise + Atmosphere',
  menuForChildren: 'Enterprise + Atmosphere',
  outdoorSeating: 'Enterprise + Atmosphere',
  parkingOptions: 'Enterprise + Atmosphere',
  paymentOptions: 'Enterprise + Atmosphere',
  reservable: 'Enterprise + Atmosphere',
  restroom: 'Enterprise + Atmosphere',
  servesBeer: 'Enterprise + Atmosphere',
  servesBreakfast: 'Enterprise + Atmosphere',
  servesBrunch: 'Enterprise + Atmosphere',
  servesCocktails: 'Enterprise + Atmosphere',
  servesCoffee: 'Enterprise + Atmosphere',
  servesDessert: 'Enterprise + Atmosphere',
  servesDinner: 'Enterprise + Atmosphere',
  servesLunch: 'Enterprise + Atmosphere',
  servesVegetarianFood: 'Enterprise + Atmosphere',
  servesWine: 'Enterprise + Atmosphere',
  takeout: 'Enterprise + Atmosphere',
};

const TIER_RANK: Record<PlacesTier, number> = {
  Essentials: 0,
  Pro: 1,
  Enterprise: 2,
  'Enterprise + Atmosphere': 3,
};

/** Quita el prefijo `places.` que llevan las mascaras de Nearby/Text Search. */
function fieldsOf(mask: string): string[] {
  return mask.split(',').map((f) => f.replace(/^places\./, ''));
}

const ALL_MASKS: Record<string, string> = {
  MASK_COMPETITOR_COUNT_DEGRADED,
  MASK_MARKET_CENSUS,
  MASK_ATMOSPHERE,
  MASK_SUBJECT_DETAIL,
  MASK_ID_REFRESH,
};

describe('integridad de las mascaras', () => {
  it.each(Object.entries(ALL_MASKS))('%s solo contiene campos conocidos', (_name, mask) => {
    const desconocidos = fieldsOf(mask).filter((f) => !(f in FIELD_TIER));
    expect(desconocidos).toEqual([]);
  });

  it.each(Object.entries(ALL_MASKS))('%s no repite ningun campo', (_name, mask) => {
    const campos = fieldsOf(mask);
    expect(campos).toHaveLength(new Set(campos).size);
  });

  it.each(Object.entries(ALL_MASKS))('%s no lleva espacios ni comas colgantes', (_name, mask) => {
    expect(mask).not.toMatch(/\s/);
    expect(mask).not.toMatch(/^,|,$|,,/);
  });
});

/**
 * EL TEST QUE PROTEGE LA FACTURA.
 *
 * Google factura al tier mas alto presente en la mascara. Un campo de mas no
 * encarece marginalmente: cambia el SKU y con el, el umbral gratuito --- de
 * 5.000 llamadas/mes a 1.000. Es el modo de fallo mas caro del proyecto y el
 * mas facil de introducir sin notarlo.
 */
describe('guardarrail de facturacion', () => {
  it.each(Object.entries(MASK_TIERS))(
    '%s no contiene ningun campo por encima de su tier declarado',
    (nombre, tierDeclarado) => {
      const mask = ALL_MASKS[nombre];
      expect(mask, `mascara ${nombre} no encontrada`).toBeDefined();

      const excedidos = fieldsOf(mask!)
        .map((campo) => ({ campo, tier: FIELD_TIER[campo]! }))
        .filter(({ tier }) => TIER_RANK[tier] > TIER_RANK[tierDeclarado]);

      expect(
        excedidos,
        `${nombre} declara ${tierDeclarado} pero incluye campos de tier superior`,
      ).toEqual([]);
    },
  );

  // La mascara de censo existe para NO pagar Atmosphere. Si alguien anade
  // `reviews` para "aprovechar la llamada", el estudio pasa de $0,035 a $0,040
  // por llamada y agota otro umbral distinto.
  it('MASK_MARKET_CENSUS no contiene ningun campo de Atmosphere', () => {
    const atmosphere = fieldsOf(MASK_MARKET_CENSUS).filter(
      (f) => FIELD_TIER[f] === 'Enterprise + Atmosphere',
    );
    expect(atmosphere).toEqual([]);
  });

  it('el modo degradado se mantiene en Pro, que es lo que le da sentido', () => {
    const caros = fieldsOf(MASK_COMPETITOR_COUNT_DEGRADED).filter(
      (f) => TIER_RANK[FIELD_TIER[f]!] > TIER_RANK.Pro,
    );
    expect(caros).toEqual([]);
    expect(NEARBY_SEARCH_PRICING.Pro.freePerMonth).toBeGreaterThan(
      NEARBY_SEARCH_PRICING.Enterprise.freePerMonth,
    );
  });
});

/**
 * EL TEST QUE PROTEGE CONTRA DINERO TIRADO.
 *
 * generativeSummary y neighborhoodSummary solo estan soportados en EE.UU. (y
 * India, en ingles). En Republica Dominicana facturan tier Enterprise +
 * Atmosphere y devuelven null. No hay sintoma visible: la llamada tiene exito,
 * el campo llega vacio, y la factura sube.
 */
describe('campos no soportados en Republica Dominicana', () => {
  it.each(Object.entries(ALL_MASKS))('%s no pide resumenes no cubiertos en RD', (_name, mask) => {
    const campos = fieldsOf(mask);
    const pedidos = UNSUPPORTED_IN_DR.filter((f) => campos.includes(f));
    expect(pedidos).toEqual([]);
  });

  it('reviewSummary SI se pide: cubre RD en espanol', () => {
    expect(fieldsOf(MASK_ATMOSPHERE)).toContain('reviewSummary');
  });
});

/**
 * EL TEST QUE PROTEGE LEGALMENTE.
 *
 * Los campos que los ToS 3.2.3(a)(iii) nombran como no almacenables pueden
 * PEDIRSE y mostrarse en vivo --- lo que no pueden es persistirse. Este test
 * documenta cuales son, para que el test de esquema de SQLite tenga contra que
 * contrastar cuando exista la base de datos.
 */
describe('campos efimeros: se muestran, no se almacenan', () => {
  const NUNCA_PERSISTIR = [
    'displayName',
    'formattedAddress',
    'reviews',
    'reviewSummary',
    'editorialSummary',
    'rating',
    'userRatingCount',
    'priceLevel',
    'priceRange',
  ];

  it('estan identificados y siguen siendo campos reales de la API', () => {
    for (const campo of NUNCA_PERSISTIR) {
      expect(FIELD_TIER[campo], `${campo} ya no existe en la tabla de tiers`).toBeDefined();
    }
  });

  // location es el unico dato de Places con permiso de cache, y es limitado:
  // 30 dias naturales segun Service Specific Terms 14.3.
  it('location e id son los unicos con permiso de persistencia', () => {
    expect(FIELD_TIER.id).toBe('Essentials');
    expect(FIELD_TIER.location).toBe('Essentials');
  });
});

describe('coste por llamada', () => {
  it('Enterprise + Atmosphere es el tier mas caro y el de menor umbral', () => {
    const ea = NEARBY_SEARCH_PRICING['Enterprise + Atmosphere'];
    expect(ea.usdPer1000).toBeGreaterThan(NEARBY_SEARCH_PRICING.Enterprise.usdPer1000);
    expect(ea.freePerMonth).toBeLessThanOrEqual(NEARBY_SEARCH_PRICING.Enterprise.freePerMonth);
  });

  // 6 llamadas de censo por estudio contra 1.000 gratis/mes = 166 estudios.
  // Si este numero baja, el presupuesto del producto cambia.
  it('el censo cabe en 166 estudios al mes dentro del umbral gratuito', () => {
    const llamadasPorEstudio = 6;
    const estudios = Math.floor(
      NEARBY_SEARCH_PRICING.Enterprise.freePerMonth / llamadasPorEstudio,
    );
    expect(estudios).toBe(166);
  });
});
