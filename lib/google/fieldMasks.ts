/**
 * Field masks canonicos de Places API (New).
 *
 * REGLA DE FACTURACION (verbatim de Google):
 *   "you are billed at the highest SKU applicable to your request"
 *
 * UN solo campo de un tier superior convierte la llamada ENTERA. Por eso las
 * mascaras son constantes, nunca se construyen inline y nunca se concatenan
 * dinamicamente. El test de fieldMasks.test.ts falla si una mascara contiene un
 * campo por encima del tier que declara.
 *
 * NEARBY SEARCH NO TIENE SKU ESSENTIALS: su suelo es Pro ($32/1k). Consecuencia
 * util: los campos Pro son gratis sobre ese suelo. Aprovechalos.
 *
 * Nombres verificados contra:
 *   https://developers.google.com/maps/documentation/places/web-service/data-fields
 * Precios: banda 0-100.000 llamadas/mes, lista oficial, verificada 2026-08-19.
 */

export type PlacesTier = 'Essentials' | 'Pro' | 'Enterprise' | 'Enterprise + Atmosphere';

/** Coste por 1.000 llamadas y umbral gratuito mensual, por tier, en Nearby Search. */
export const NEARBY_SEARCH_PRICING: Record<PlacesTier, { usdPer1000: number; freePerMonth: number }> =
  {
    // Nearby Search no tiene SKU Essentials. Se declara para completitud del
    // tipo, con el precio del suelo real (Pro), que es lo que se factura.
    Essentials: { usdPer1000: 32, freePerMonth: 5000 },
    Pro: { usdPer1000: 32, freePerMonth: 5000 },
    Enterprise: { usdPer1000: 35, freePerMonth: 1000 },
    'Enterprise + Atmosphere': { usdPer1000: 40, freePerMonth: 1000 },
  };

/**
 * MODO DEGRADADO. Se usa solo cuando el presupuesto duro dispara.
 *
 * SKU:   Nearby Search Pro - $32/1k - 5.000 gratis/mes - $0,032 por llamada
 *
 * businessStatus, primaryType y primaryTypeDisplayName son Pro y por tanto
 * gratis sobre el suelo de Nearby. Incluirlos no cuesta nada y businessStatus
 * es lo que permite excluir CLOSED_PERMANENTLY del conteo.
 *
 * PROHIBIDO anadir aqui: rating, userRatingCount, priceLevel, priceRange,
 * regularOpeningHours, nationalPhoneNumber, websiteUri -> suben a Enterprise.
 */
export const MASK_COMPETITOR_COUNT_DEGRADED = [
  'places.id', // Essentials - persistible indefinidamente
  'places.location', // Essentials - cache maximo 30 dias (SST 14.3)
  'places.types', // Essentials - NO es Pro, error frecuente
  'places.primaryType', // Pro - gratis sobre el suelo Pro
  'places.primaryTypeDisplayName', // Pro - gratis
  'places.businessStatus', // Pro - gratis - excluye CLOSED_PERMANENTLY
].join(',');

/**
 * MASCARA PRINCIPAL DE CENSO. Fase A del pipeline de caracterizacion.
 *
 * SKU:   Nearby Search Enterprise - $35/1k - 1.000 gratis/mes - $0,035/llamada
 *        A 6 llamadas por estudio: 166 estudios/mes dentro del umbral gratuito.
 *
 * Superconjunto de la mascara Pro por solo +$3/1.000. Fusiona lo que antes eran
 * dos pasadas (conteo Pro + detalle Enterprise) en una sola:
 * 6 llamadas ($0,210) en vez de 9 ($0,297).
 *
 * priceRange devuelve {startPrice, endPrice}, ambos objetos Money con
 * currencyCode: mapea 1:1 sobre el Money de Esodeja, sin conversion FX
 * implicita.
 *
 * PROHIBIDO anadir aqui: reviews, reviewSummary, editorialSummary o cualquier
 * booleano de atributo -> suben a Enterprise + Atmosphere ($40/1k).
 */
export const MASK_MARKET_CENSUS = [
  'places.id', // Essentials
  'places.location', // Essentials - cache maximo 30 dias
  'places.types', // Essentials
  'places.primaryType', // Pro
  'places.primaryTypeDisplayName', // Pro
  'places.businessStatus', // Pro
  'places.displayName', // Pro - EFIMERO, jamas a la BD (ToS 3.2.3(a)(iii))
  'places.rating', // Enterprise - media POBLACIONAL, no muestral
  'places.userRatingCount', // Enterprise - el N verdadero tras el rating
  'places.priceLevel', // Enterprise - enum FREE..VERY_EXPENSIVE
  'places.priceRange', // Enterprise - Money{startPrice,endPrice}
].join(',');

/**
 * MASCARA DE CARACTERIZACION. Fase B. El nucleo del levantamiento cualitativo.
 *
 * SKU:   Nearby Search Enterprise + Atmosphere - $40/1k - 1.000 gratis/mes
 *        $0,040 por llamada, hasta 20 lugares -> $0,0020 por lugar.
 *
 * NUNCA usar Place Details para esto: $25/1k entre 1 lugar = $0,025 por lugar.
 * Factor 12,5x. Place Details E+A se reserva al local del propio usuario.
 *
 * NO INCLUYE, deliberadamente:
 *   - generativeSummary   -> soportado solo en EE.UU. e India, en ingles.
 *                            En RD factura tier E+A y devuelve null.
 *   - neighborhoodSummary -> soportado solo en EE.UU., en ingles. Idem.
 *
 * reviewSummary SI cubre Republica Dominicana en espanol (verificado contra
 * /review-summaries). Es la pieza que sustituye a un pipeline de NLP propio:
 * la sintesis la produce Google, no se persiste, y evita toda la zona gris de
 * derivar sentimiento a partir de contenido de Places.
 *
 * TODO lo que devuelve esta mascara es EFIMERO. Ni un campo toca SQLite.
 * Obligaciones de exhibicion:
 *   - reviews       -> authorAttribution + googleMapsUri visibles
 *   - reviewSummary -> disclosureText ("Resumido con Gemini") + reviewsUri
 *   - nunca junto a un mapa no-Google (SST 14.2)
 */
export const MASK_ATMOSPHERE = [
  'places.id',
  'places.displayName', // Pro - efimero
  'places.primaryType', // Pro
  'places.rating', // Enterprise
  'places.userRatingCount', // Enterprise
  'places.priceLevel', // Enterprise
  'places.priceRange', // Enterprise
  // --- Enterprise + Atmosphere desde aqui ---
  'places.reviews', // MAXIMO 5, ordenadas por RELEVANCIA
  'places.reviewSummary', // cubre RD en espanol
  'places.editorialSummary', // sin restriccion regional; muy disperso
  'places.delivery',
  'places.dineIn',
  'places.takeout',
  'places.curbsidePickup',
  'places.reservable',
  'places.outdoorSeating',
  'places.liveMusic',
  'places.restroom',
  'places.goodForChildren',
  'places.goodForGroups',
  'places.goodForWatchingSports',
  'places.menuForChildren',
  'places.allowsDogs',
  'places.servesBreakfast',
  'places.servesLunch',
  'places.servesDinner',
  'places.servesBrunch',
  'places.servesCoffee',
  'places.servesDessert',
  'places.servesBeer',
  'places.servesWine',
  'places.servesCocktails',
  'places.servesVegetarianFood',
  'places.parkingOptions', // 7 sub-booleanos
  'places.paymentOptions', // 4 sub-booleanos
  'places.accessibilityOptions', // 4 sub-booleanos
].join(',');

/**
 * FICHA DEL LOCAL DEL USUARIO. Un solo lugar, nunca competencia.
 *
 * SKU:   Place Details Enterprise + Atmosphere - $25/1k - 1.000 gratis/mes
 *
 * Sin prefijo `places.`: Place Details usa nombres desnudos.
 * UNA sola llamada por estudio. Si aparece dentro de un bucle, es un bug.
 */
export const MASK_SUBJECT_DETAIL = [
  'id',
  'location',
  'types',
  'primaryType',
  'primaryTypeDisplayName',
  'businessStatus',
  'displayName',
  'formattedAddress',
  'rating',
  'userRatingCount',
  'priceLevel',
  'priceRange',
  'regularOpeningHours',
  'reviews',
  'reviewSummary',
  'editorialSummary',
].join(',');

/**
 * Refresco de place_id. Google lo documenta como SIN COSTE.
 * Ejecutar sobre place_ids con mas de 12 meses de antiguedad.
 */
export const MASK_ID_REFRESH = 'id';

/** El tier que declara cada mascara. Fuente de verdad del test de guardarrail. */
export const MASK_TIERS = {
  MASK_COMPETITOR_COUNT_DEGRADED: 'Pro',
  MASK_MARKET_CENSUS: 'Enterprise',
  MASK_ATMOSPHERE: 'Enterprise + Atmosphere',
  MASK_SUBJECT_DETAIL: 'Enterprise + Atmosphere',
  MASK_ID_REFRESH: 'Essentials',
} as const satisfies Record<string, PlacesTier>;

/**
 * Campos NO soportados en Republica Dominicana.
 *
 * No es una cuestion de tier: estos facturan Enterprise + Atmosphere y
 * devuelven null en RD, sin ningun sintoma visible. Es dinero tirado.
 */
export const UNSUPPORTED_IN_DR = ['generativeSummary', 'neighborhoodSummary'] as const;
