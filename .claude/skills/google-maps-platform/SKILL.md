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

Además, cada cuenta de facturación de Maps mantiene un **crédito recurrente de
$200/mes que no caduca**, independiente del crédito de bienvenida del trial.

### SKUs que usa Esodeja

| API | Tier | Gratis/mes | Uso |
|---|---|---|---|
| Maps JavaScript API | Essentials | 10.000 | Mapa, selección, dibujo de polígono |
| Places — Nearby Search | Pro / Enterprise | 5.000 / 1.000 | Competencia por radio y categoría |
| Places — Place Details | Essentials | 10.000 | Ficha del local o de un competidor |
| Places — Text Search | Pro | 5.000 | Búsqueda para posicionar el pin |
| Geocoding | Essentials | 10.000 | Dirección ↔ coordenada |
| Routes — Compute Route Matrix | Pro | 5.000 | Tiempos para isócronas aproximadas |
| Maps Static | Essentials | 10.000 | Mapa embebido en el reporte impreso |
| Street View Static | Essentials | 10.000 | Foto de fachada en el reporte |

## 3. Field masks: la palanca que decide la factura

**Esto es lo más importante de esta skill.**

En Places API (New) la cabecera `X-Goog-FieldMask` determina el tier de
facturación de la llamada. Pedir un campo de más no encarece marginalmente:
**cambia el SKU entero**, y con él el umbral gratuito, de 5.000 a 1.000.

Campos que **suben la llamada a Enterprise**: `rating`, `userRatingCount`,
`priceLevel`, `regularOpeningHours`, `currentOpeningHours`,
`nationalPhoneNumber`, `internationalPhoneNumber`, `websiteUri`, `reviews`.

### Reglas de implementación

1. Las máscaras viven como **constantes exportadas** en `lib/google/fieldMasks.ts`.
2. **Nunca** se construye una máscara inline en el punto de llamada.
3. **Nunca** se concatena una máscara dinámicamente.
4. Cada constante lleva comentario con su tier y su coste por 1.000.
5. Existe un test que **falla si una llamada declarada Pro incluye un campo
   Enterprise**.

### Las dos máscaras canónicas de Esodeja

```ts
// Tier: Pro (~$32/1k, 5.000 gratis/mes)
// Para contar densidad de competencia. NO añadir rating ni priceLevel aquí.
export const MASK_COMPETITOR_COUNT = 'places.id,places.location,places.types';

// Tier: Enterprise (~$35/1k, 1.000 gratis/mes)
// SOLO para el radio de 250 m, donde la lista nominal importa de verdad.
export const MASK_COMPETITOR_DETAIL =
  'places.id,places.location,places.types,places.displayName,' +
  'places.rating,places.userRatingCount,places.priceLevel,places.businessStatus';
```

## 4. Términos de Servicio: qué se puede guardar

Restricción legal dura. Los Términos Específicos de Servicio prohíben
exportar, extraer o cachear contenido de Maps salvo excepciones expresas.

| Dato | Permiso | Consecuencia de diseño |
|---|---|---|
| `place_id` | **Indefinido** | Es la clave estable de un competidor entre estudios |
| Latitud / longitud | **Máximo 30 días naturales** | Columna `cached_at` + reaper obligatorio |
| Nombre, rating, nº reseñas, precio, horarios, teléfono, fotos | **No almacenable** | Se pide en vivo en cada render. No existe columna para ellos |
| Métricas agregadas calculadas por nosotros | Permitido | Es análisis propio, no contenido de Google |

**Atribución:** el contenido de Places debe mostrarse sobre un mapa de Google.
Se cumple por construcción al usar Maps JS API. No lo rompas renderizando
resultados de Places en una vista sin mapa.

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

Es una **aproximación** y la UI debe etiquetarla como tal. Coste: 1 llamada
Pro por modo de transporte y umbral.

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
