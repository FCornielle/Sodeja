---
name: google-maps-platform
description: Referencia operativa de Google Maps Platform para Esodeja — SKUs y tiers de facturación, field masks canónicos de Places API (New), reglas de caché y atribución de los Términos de Servicio, patrón de medición de coste, y las limitaciones conocidas de la plataforma (no hay API de isócronas). Carga esta skill ANTES de escribir o modificar cualquier código que llame a googleapis.com o que diseñe una tabla que almacene datos de Places.
---

# Google Maps Platform — referencia operativa de Esodeja

Datos verificados en agosto de 2026. **Los precios y tiers de Google cambian:
si una cifra parece desalineada con la factura real, verifica contra
[la página de precios](https://mapsplatform.google.com/pricing/) antes de
actuar, y actualiza este fichero.**

## 1. Las dos claves

| Variable | Ámbito | Restricción en Cloud Console |
|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY` | Navegador. **Solo** Maps JavaScript API | Referrer HTTP: `localhost:3000/*` + dominio de producción |
| `GOOGLE_MAPS_SERVER_KEY` | **Solo servidor.** Places, Routes, Geocoding, Static, Street View | Sin referrer. Restringida por API a ese conjunto exacto |

La clave de servidor nunca lleva prefijo `NEXT_PUBLIC_`, nunca aparece en un
componente cliente, nunca se pasa como prop. Si el navegador puede leerla,
está filtrada y hay que rotarla.

## 2. Modelo de facturación

Desde marzo de 2025, Google sustituyó el crédito único de $200 por **umbrales
gratuitos por SKU**:

| Tier | Gratis al mes | Rango de precio típico |
|---|---|---|
| **Essentials** | 10.000 llamadas | $2–$7 por 1.000 |
| **Pro** | 5.000 llamadas | ~$32 por 1.000 |
| **Enterprise** | 1.000 llamadas | ~$35 por 1.000 |
| **Enterprise + Atmosphere** | 1.000 llamadas † | ~$40 por 1.000 |

**Son cuatro tiers, no tres.** `Enterprise + Atmosphere` es el que contiene
`reviews`, `reviewSummary`, `editorialSummary` y todos los booleanos de
atributos operativos. Omitirlo del modelo mental es cómo se cuela una factura
inesperada.

† El umbral gratuito de Enterprise + Atmosphere no aparece desglosado como tier
propio en la página de precios pública. Se trata como familia Enterprise
(1.000/mes, **por SKU**). **Confirmar en el primer ciclo de facturación real** —
es el único número de esta skill sin verificación de primera parte.

Los umbrales son **por SKU**: `Nearby Search Enterprise` y `Nearby Search
Enterprise + Atmosphere` tienen cada uno sus 1.000, no los comparten.

Además, cada cuenta de facturación de Maps mantiene un **crédito recurrente de
$200/mes que no caduca**, independiente del crédito de bienvenida del trial.

**Regla de facturación (verbatim de Google):** *"you are billed at the highest
SKU applicable to your request"*. Un solo campo de tier superior en la máscara
convierte la llamada **entera**.

### SKUs que usa Esodeja

| API | Tier | Gratis/mes | USD/1.000 | Uso |
|---|---|---|---|---|
| Maps JavaScript (Dynamic Maps) | Essentials | 10.000 | $7 | Mapa, selección, dibujo |
| Places — Nearby Search | **Pro es el suelo** | 5.000 | $32 | Censo de competencia |
| Places — Nearby Search | Enterprise | 1.000 | $35 | + rating, precio |
| Places — Nearby Search | Ent. + Atmosphere | 1.000 † | $40 | + reseñas, atributos |
| Places — Place Details | Ent. + Atmosphere | 1.000 † | $25 | **Solo el local del usuario** |
| Places — Text Search | Pro | 5.000 | $32 | Búsqueda para el pin |
| Geocoding | Essentials | 10.000 | $5 | Dirección ↔ coordenada |
| Routes — Compute Route Matrix | Essentials | 10.000 | $5 **por elemento** | Isócronas |
| Maps Static | Essentials | 10.000 | $2 | Mapa del reporte |
| Street View Static | Essentials | 10.000 | $7 | Fachada del reporte |

### Dos consecuencias que cambian el diseño

**(a) Nearby Search no tiene SKU Essentials — su suelo es Pro.** Por tanto los
campos Pro (`businessStatus`, `primaryType`, `primaryTypeDisplayName`) son
**gratis** sobre ese suelo. Omitirlos es dejar información en la mesa. En
particular, sin `businessStatus` el conteo de competencia incluye locales
`CLOSED_PERMANENTLY`: el número más visible del producto sale inflado por
construcción.

**(b) Para caracterizar competencia, Nearby Search — nunca Place Details.**

| Ruta | USD/llamada | Lugares/llamada | **USD por lugar** |
|---|---|---|---|
| Nearby Search Ent. + Atmosphere | $0,040 | hasta 20 | **$0,0020** |
| Place Details Ent. + Atmosphere | $0,025 | 1 | **$0,0250** |

Factor **12,5×**. Caracterizar 40 competidores cuesta $0,08 por Nearby y $1,00
por Place Details — esto último, por sí solo, rompería el techo de alarma de
$1/estudio. Place Details queda reservado a **un** lugar: el local que el
usuario evalúa.

## 3. Field masks: la palanca que decide la factura

**Esto es lo más importante de esta skill.**

En Places API (New) la cabecera `X-Goog-FieldMask` determina el tier de
facturación de la llamada. Pedir un campo de más no encarece marginalmente:
**cambia el SKU entero**, y con él el umbral gratuito, de 5.000 a 1.000.

### Reparto de campos por tier

Verificado contra [Place Data Fields](https://developers.google.com/maps/documentation/places/web-service/data-fields).
En Nearby y Text Search los nombres llevan prefijo `places.`; en Place Details van desnudos.

**Essentials** — `id` · `name` · `attributions` · `photos` · `addressComponents`
· `formattedAddress` · `location` · `plusCode` · `shortFormattedAddress` ·
**`types`** · `viewport`

> `types` es **Essentials**, no Pro. Es un error frecuente.

**Pro** — `businessStatus` · `displayName` · `googleMapsUri` · `openingDate` ·
**`primaryType`** · **`primaryTypeDisplayName`** · `timeZone` ·
`utcOffsetMinutes` · `pureServiceAreaBusiness`

**Enterprise** — `currentOpeningHours` · `regularOpeningHours` ·
`internationalPhoneNumber` · `nationalPhoneNumber` · **`priceLevel`** ·
**`priceRange`** · **`rating`** · **`userRatingCount`** · `websiteUri`

**Enterprise + Atmosphere** — **`reviews`** · **`reviewSummary`** ·
**`editorialSummary`** · `generativeSummary` · `neighborhoodSummary` ·
`accessibilityOptions` · `allowsDogs` · `curbsidePickup` · `delivery` ·
`dineIn` · `goodForChildren` · `goodForGroups` · `liveMusic` · `outdoorSeating`
· `parkingOptions` · `paymentOptions` · `reservable` · `restroom` ·
`servesBreakfast` · `servesLunch` · `servesDinner` · `servesBrunch` ·
`servesCoffee` · `servesDessert` · `servesBeer` · `servesWine` ·
`servesCocktails` · `servesVegetarianFood` · `takeout`

`priceRange` devuelve `{startPrice, endPrice}`, **ambos objetos `Money` con
`currencyCode`**. Mapea 1:1 sobre el `Money` de Esodeja, sin conversión FX
implícita. Es una fuente de precio mucho más fuerte que el `priceLevel`
categórico.

### Cobertura regional de los tres resúmenes — no es uniforme

| Campo | ¿Cubre República Dominicana? | Qué hacer |
|---|---|---|
| **`reviewSummary`** | ✅ **Sí, en español** (verificado) | **Pedirlo siempre** |
| `generativeSummary` | ❌ No — solo EE.UU. e India, en inglés | **No pedirlo nunca** |
| `neighborhoodSummary` | ❌ No — solo EE.UU., en inglés | **No pedirlo nunca** |

Los dos últimos **facturan tier Enterprise + Atmosphere y devuelven `null` en
RD**. Pedirlos es dinero tirado sin ningún síntoma visible.

**`reviewSummary` es la pieza clave de la caracterización cualitativa**: Google
produce él mismo la síntesis de las reseñas, en español, para RD. Estructura:
`{text, flagContentUri, disclosureText, reviewsUri}`. El `disclosureText`
("Resumido con Gemini") y el enlace `reviewsUri` son de **exhibición
obligatoria**.

### Reglas de implementación

1. Las máscaras viven como **constantes exportadas** en `lib/google/fieldMasks.ts`.
2. **Nunca** se construye una máscara inline en el punto de llamada.
3. **Nunca** se concatena una máscara dinámicamente.
4. Cada constante lleva comentario con su tier y su coste por 1.000.
5. Existe un test que **falla si una máscara contiene un campo de tier superior
   al que declara** — contra los cuatro tiers, no tres.
6. Existe un test que **falla si alguna máscara contiene `generativeSummary` o
   `neighborhoodSummary`** — no por tier, sino porque en RD facturan y devuelven
   `null`.

Las cuatro máscaras canónicas están en `lib/google/fieldMasks.ts` con su tier,
su coste y su justificación anotados. No las dupliques aquí: lee el fichero.

## 4. Términos de Servicio: qué se puede guardar

Restricción legal dura. Los Términos Específicos de Servicio prohíben
exportar, extraer o cachear contenido de Maps salvo excepciones expresas.

Las cláusulas que gobiernan son **ToS §3.2.3 (a) No Scraping, (b) No Caching,
(c) No Creating Content**, más **Service Specific Terms §14** (Places).

| Dato | Permiso | Base |
|---|---|---|
| `id` (place_id) | **Indefinido** | Exención explícita a §3.2.3(b). Refrescar a los 12 meses con máscara solo-`id`, que **no tiene coste** |
| `location` (lat/lng) | **Máximo 30 días naturales** | SST §14.3, literal |
| `displayName`, `formattedAddress` | **Nunca** | §3.2.3(a)(iii) nombra *business names, addresses* |
| **Texto de `reviews`** | **Nunca** | §3.2.3(a)(iii) nombra ***user reviews*** literalmente |
| `reviewSummary.text` | **Nunca** | Contenido de Google. Además exige `disclosureText` visible |
| `rating`, `userRatingCount`, `priceLevel`, `priceRange` | **Nunca** | Contenido de Places. En vivo en cada render |
| Booleanos de atributos por lugar | **Nunca** | Contenido de Places |
| Sentimiento derivado por reseña o por lugar | **Nunca** | §3.2.3(c) — es un derivado 1:1 del contenido |
| Fine-tuning de un modelo sobre reseñas | **Nunca** | §3.2.3(c)(vii), prohibición nominal |
| Agregado de zona, k≥5, sin `place_id` | **Sí** (30 días recomendado) | Análisis propio. Ver advertencia abajo |
| Supuestos y proyección del usuario | **Indefinido** | No es contenido de Google |

### La frontera del derivado

Un score de sentimiento almacenado y vinculado a un `place_id` **no** es
análisis propio: es la reseña con otro formato. Que ocupe 4 bytes en vez de 400
no cambia la naturaleza de la operación.

Test operativo útil: *si borro la reseña y me quedo con el derivado, ¿el
derivado sigue diciendo algo sobre esa reseña concreta?* Si sí, es contenido de
Google.

Un agregado sobre **≥5 lugares**, guardado contra la **zona y el estudio** (nunca
contra un `place_id`) y etiquetado como medición propia con su metodología, su
n y su fecha, sí es análisis nuestro.

> **Advertencia honesta:** esta postura es defendible pero es más fuerte que lo
> que la redacción de Google respalda explícitamente. En SST §13.2 (Places
> Aggregate API) Google impone 30 días de caché a **un simple conteo**. Es otra
> API y no nos vincula, pero muestra que Google no considera que un agregado
> quede automáticamente libre de la regla de caché. Aplica voluntariamente los
> 30 días también a los agregados de zona: cuesta poco y elimina la exposición.

### Atribución — la regla real

**Corrección a una versión anterior de esta skill**, que afirmaba que el
contenido de Places debe mostrarse sobre un mapa de Google. **Es falso.**
SST §14.1 dice literalmente que el cliente *puede* usar contenido de Places
**sin** un mapa de Google. Lo prohibido es §14.2: usarlo junto a un mapa
**no-Google** (Mapbox, Leaflet, OSM).

| Situación | ¿Permitido? |
|---|---|
| Contenido de Places sin ningún mapa | ✅ Sí |
| Contenido de Places con mapa de Google | ✅ Sí |
| Contenido de Places con mapa no-Google | ❌ **No** |

Consecuencia práctica buena: **la hoja de impresión del reporte puede llevar
tablas de competencia sin incrustar un mapa.**

Lo que sí sigue siendo obligatorio (§3.2.2(b) y políticas de Places):
`authorAttribution` visible en toda reseña mostrada, `googleMapsUri` accesible,
y `disclosureText` + `reviewsUri` junto a todo `reviewSummary`.

### Punto-en-polígono: prohibido con coordenadas de Places

§3.2.3(c)(iv) lista como ejemplo prohibido, literal:

> *use latitude/longitude values from the Places API as an input for
> **point-in-polygon analysis***

Esto afecta directamente a Esodeja, que usa Turf.js para geometría. La ruta
obvia es la prohibida. Reglas:

1. **La competencia se filtra por radio, no por polígono.** El
   `locationRestriction` circular de Nearby Search ya lo resuelve en el servidor
   de Google. No hay nada que hacer en Turf.
2. **La población alcanzable es** polígono de isócrona ∩ geometría censal de la
   ONE. El conjunto de puntos es de la ONE, no de Places: la cláusula no aplica.
3. **Nunca** pasar `places.location` a `turf.booleanPointInPolygon` ni a
   `turf.pointsWithinPolygon`.

El producto no pierde ninguna capacidad. Pero la ruta ingenua sí incumple.

### Lo que esto significa para el producto

Un estudio archivado hace cuatro meses conserva sus conclusiones y sus
agregados — *"18 restaurantes en 500 m, rating medio 4,1, medido el
2026-08-19"* — pero **no puede volver a mostrar la lista nominal de
competidores** sin re-consultar y re-facturar. Es correcto y es como debe ser.
No intentes esquivarlo.

## 5. Medición de coste

Ninguna llamada sale sin pasar por `lib/google/meter.ts`, que registra en la
tabla `api_call`: timestamp, SKU, tier, coste estimado, y el id del estudio
que la originó.

Tres controles construidos sobre eso:

1. **Badge en pantalla** con el coste real del estudio en curso.
2. **Presupuesto mensual duro** (`MONTHLY_BUDGET_USD`): al 80% avisa, al 100%
   bloquea llamadas Pro/Enterprise y ofrece modo degradado.
3. **Reconciliación**: el gasto estimado debe cuadrar con Cloud Billing dentro
   del ±20%. Si no cuadra, la tabla de precios de esta skill está desfasada.

**Coste de referencia de un estudio completo: $0,40–0,55.** Si un estudio se
dispara por encima de $1, hay una máscara mal puesta o un bucle de llamadas.

## 6. Limitaciones de la plataforma que sorprenden

### Google no tiene API de isócronas

No existe endpoint que devuelva "el polígono alcanzable en 10 minutos". La
aproximación de Esodeja:

1. Generar ~24 puntos de sonda en abanico radial alrededor del origen.
2. **Una sola** llamada a Compute Route Matrix (1 origen × 24 destinos).
3. Construir el polígono uniendo los puntos bajo el umbral de tiempo.

Es una **aproximación** y la UI debe etiquetarla como tal.

> **Compute Route Matrix factura por ELEMENTO, no por llamada.** Verbatim de
> Google: *"billed per ELEMENT returned from the request. The number of elements
> is the number of origins multiplied by the number of destinations."*
>
> 1 origen × 24 sondas = **24 elementos facturables**. La isócrona cuesta
> **$0,120**, no $0,005. Con dos modos y dos umbrales serían 96 elementos
> ($0,48) — más que todo el resto del estudio junto.
>
> **La isócrona es la partida más cara de Esodeja.** El medidor de coste debe
> contar **elementos**, no llamadas, o la reconciliación del ±20% contra Cloud
> Billing fallará y se culpará a la tabla de precios en vez de al medidor.

### Places Insights está fuera de alcance

Es el producto que Google diseña específicamente para site selection y market
research (250M+ POIs agregados, refresco mensual, series temporales desde
enero de 2024). Sería ideal para Esodeja. Pero:

- Se accede **solo vía BigQuery**, con alta previa en un data exchange.
- Su cobertura documentada tiene **EE.UU. como foco**, con datos de marcas en
  Canadá, Gran Bretaña y Australia.
- **No hay confirmación de cobertura de República Dominicana.**

Queda registrado como candidato a evaluar, **no como dependencia**. Verificar
cobertura de RD antes de construir nada contra él.

### Nearby Search trunca resultados

Hay tope de resultados por llamada. Para densidad, usa conteos por radio; no
intentes paginar hasta agotar. **Si un radio satura el tope, repórtalo como
`20+`, nunca como `20`** — un conteo truncado presentado como exacto es un
dato falso.

### El límite de reseñas es 5, y es duro

Verbatim de la referencia REST: *"A maximum of 5 reviews can be returned."* Y
vienen **ordenadas por relevancia**, no por fecha.

No hay forma legítima de obtener más:

- **No hay paginación de reseñas.** El array `reviews[]` no tiene cursor ni
  token. El `nextPageToken` de búsqueda paginaría *lugares*, no reseñas.
- **`languageCode` no amplía el conjunto**, solo traduce `text` (el original
  queda en `originalText`).
- **Business Profile API no sirve**: devuelve todas las reseñas, pero solo del
  negocio que tú posees y verificas. Inaplicable a competencia.
- **Comprar el dato a un tercero no lava su origen.** Cualquier proveedor que
  ofrezca "todas las reseñas de Google" las obtuvo raspando; distribuirlas
  seguiría siendo violación.

**Consecuencia estadística, que hay que respetar en la UI:** con n=5 y p=0,5 el
error estándar es 0,224 → intervalo al 95% de **±44 puntos porcentuales**. Un
lugar "70% positivo" es indistinguible de uno "30% positivo". Y la muestra no es
aleatoria: está sesgada por una función de relevancia no documentada, y un sesgo
desconocido no se corrige.

> **`rating` y `userRatingCount` son parámetros poblacionales. `reviews` es una
> muestra sesgada de tamaño 5. Nunca aparecen en la misma frase cuantitativa.**

`rating` es la media de Google sobre **todas** las valoraciones del lugar, sin
error de muestreo. Sobre ese eje Esodeja tiene *más* poder estadístico que
cualquier scraper, no menos.

### No hay datos de tráfico peatonal

Google Popular Times no tiene API pública y raspar la web viola los términos.
Para República Dominicana no existe fuente de foot traffic a ningún precio
practicable. Lo más cercano que Esodeja ofrece es isócrona + población, y se
etiqueta explícitamente como proxy.

## 7. Fechas de control del crédito

| Fecha | Qué |
|---|---|
| **2026-10-07** | Decidir conversión de la cuenta de facturación, con datos reales del medidor |
| **~2026-10-21** | Expira el crédito de bienvenida de $300 |

Si el trial expira **sin convertir**, Google cierra la cuenta de facturación y
**detiene proyectos y recursos asociados**. Convertir no implica gastar: los
$200/mes recurrentes siguen aplicando y por debajo de ese umbral la factura es
cero.
