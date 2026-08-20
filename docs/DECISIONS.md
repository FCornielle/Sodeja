# Decisiones de producto

Dueño: `esodeja-pm`. Una decisión entra aquí cuando sería difícil de
reconstruir mirando el código, o cuando alguien va a querer reabrirla.

---

## D-1 · Reconstruir en vez de refactorizar SODEJA — 2026-08-19

**Contexto.** El proyecto anterior (`../First Agentic Workflow/`) tiene ~19.000
líneas de código productivo, 406 tests y 26 endpoints REST funcionales sobre
PostGIS. La calidad es alta y la deuda técnica casi nula: 0 TODOs, 0 FIXMEs. Y
aun así nunca produjo un solo estudio de mercado.

**Decisión.** Repo limpio, portando a mano tres activos validados: el motor de
cálculo, las reglas de nómina dominicana y los seeds de contenido. Todo lo demás
se descarta.

**Por qué.** El fallo no fue de ejecución sino de una regla puesta al inicio y
nunca revisada — *"ningún servicio de pago será aprovisionado"* — que produjo
cuatro agujeros simultáneos: mapa sin tiles propios (el código se autodescribía
como `UNVERIFIED placeholder`), proveedor de POI lanzando `NOT_CONFIGURED`
siempre, adaptadores de Google escritos y **nunca ejecutados**, y un peso
operativo (12 workspaces, Docker, PostGIS obligatorio) que hacía lenta cada
iteración. Refactorizar arrastraría el peso; empezar de cero perdería la
curación de datos dominicanos, que es el activo real.

**Se pierde.** Los tests de integración con PostGIS y la infraestructura de
resiliencia de providers. Ambos protegían código que no se va a conservar.

---

## D-2 · La aplicación es de un solo usuario — 2026-08-19

**Decisión.** Sin autenticación, sin multi-tenancy, sin RLS, sin aceptación de
ToS versionada, sin consentimiento Ley 172-13, sin endpoints de export/delete.

**Por qué.** El dueño la usa para sus propios estudios. Esas piezas eran ~40%
del alcance del proyecto anterior y no aportan nada a un usuario único.

**Condición de reapertura.** Si en algún momento hay un segundo usuario, esto se
reabre **antes** de que ese usuario exista, no después.

---

## D-3 · Sin abstracción de proveedores — 2026-08-19

**Decisión.** Se llama a Google directamente desde módulos server-side finos. No
hay registry, ni interfaz de proveedor, ni circuit breaker, ni rate limiter.
Timeout y un reintento con backoff, nada más.

**Por qué.** El proyecto anterior construyó los tres, con 66 tests, para
adaptadores que **nunca se llamaron ni una vez**. Peor: el flujo de estudio de
mercado ni siquiera pasaba por esa capa — leía Postgres directo. Era código
muerto con cobertura de tests.

**Regla derivada.** `esodeja-pm` tiene veto explícito sobre cualquier
abstracción que no tenga hoy **dos implementaciones reales en uso**. La
resiliencia se añade cuando algo falle de verdad y exista el log que lo
demuestre.

---

## D-4 · SQLite y Turf.js en vez de Postgres y PostGIS — 2026-08-19

**Decisión.** Base de datos en fichero con `better-sqlite3`. Operaciones
espaciales con Turf.js en JavaScript.

**Por qué.** `npm run dev` debe arrancar la aplicación completa sin ningún
demonio. En el proyecto anterior los tests de base de datos corrían migraciones
antes de nada, lo que hacía que **toda la suite dependiera de un Postgres vivo**.
A escala de dos ciudades y un usuario, Turf cubre punto-en-polígono, distancias
e intersección de isócronas de sobra.

**Se pierde.** Índices espaciales. Irrelevante a este volumen; si algún día deja
de serlo, será un problema medible, no especulado.

---

## D-5 · Places Insights queda fuera de alcance — 2026-08-19

**Contexto.** Es el producto que Google diseña específicamente para site
selection y market research: 250M+ POIs agregados, refresco mensual, series
temporales desde enero de 2024. Sería ideal para Esodeja.

**Decisión.** No se construye contra él. Queda como candidato a evaluar.

**Por qué.** Se accede solo vía BigQuery con alta previa en un data exchange, y
su cobertura documentada tiene EE.UU. como foco, con datos de marcas en Canadá,
Gran Bretaña y Australia. **No hay confirmación de cobertura de República
Dominicana.** Planificar contra una fuente cuya cobertura no se ha verificado es
exactamente el error que el proyecto anterior cometió con Overture (proveedor de
POI que nunca se implementó) y con ACOPROVI (cifras de fit-out que resultaron
mal atribuidas desde blogs inmobiliarios).

**Condición de reapertura.** Verificar cobertura de RD primero. Si la hay, se
evalúa el coste de BigQuery frente al de Places API en vivo.

---

## D-6 · Las isócronas son una aproximación, y se etiqueta — 2026-08-19

**Contexto.** Google no tiene API de isócronas. No existe endpoint que devuelva
el polígono alcanzable en 10 minutos.

**Decisión.** Se aproxima con un abanico radial de ~24 puntos de sonda y **una**
llamada a Compute Route Matrix (1 origen × 24 destinos), uniendo los puntos bajo
el umbral. La UI lo etiqueta explícitamente como aproximación.

**Por qué.** Es la única forma de obtener accesibilidad con las APIs
disponibles, y cuesta 1 llamada Pro por modo y umbral. Presentarla como exacta
sería un dato falso con apariencia de precisión.

---

## D-7 · Sin app nativa — 2026-08-19

**Decisión.** Se usa desde el navegador, también en el móvil. La UI es
responsive por diseño. No hay proyecto Android ni iOS.

**Por qué.** Un solo usuario, y el `apps/mobile` del proyecto anterior nunca pasó
de un README sin `package.json`. Confirmado por el dueño.

---

## D-8 · El reporte se imprime, no se genera — 2026-08-19

**Decisión.** El reporte es la misma página con una hoja `@media print` y
`window.print()`. No hay generador de PDF.

**Por qué.** El proyecto anterior tenía un worker de PDF con cola en memoria,
storage driver y Playwright headless — 905 líneas de infraestructura para
producir un documento. `window.print()` da el mismo PDF con cero infraestructura
y cero superficie de fallo.

**Se pierde.** Generación de reportes en segundo plano. No hace falta: el usuario
está mirando la pantalla cuando lo pide.

---

## D-9 · El esquema de datos lo dictan los ToS de Google — 2026-08-19

**Decisión.** `place_id` se almacena indefinidamente; las coordenadas máximo 30
días con `cached_at` y reaper; nombre, rating, reseñas, precio, horarios,
teléfono y fotos **nunca** tocan la base de datos; las métricas agregadas
calculadas por nosotros sí se almacenan.

**Por qué.** Restricción legal, no preferencia. Los Términos Específicos de
Servicio prohíben exportar, extraer o cachear contenido de Maps salvo excepciones
expresas.

**Consecuencia que hay que aceptar.** Un estudio de hace cuatro meses conserva
sus conclusiones y sus agregados, pero **no puede volver a mostrar la lista
nominal de competidores** sin re-consultar y re-facturar. Es correcto y es como
debe ser.

**Verificación.** Un test inspecciona el esquema y falla si aparece cualquier
columna prohibida. Otro verifica que el reaper borra coordenadas de más de 30
días.

---

## D-10 · E-3 (medidor de coste) va antes que E-2 y E-4 — 2026-08-19

**Decisión.** El medidor de coste, el presupuesto duro y el badge en pantalla se
construyen antes que el mapa y antes que la búsqueda de competencia.

**Por qué.** Es el único item del Sprint 1 que no produce valor visible, y aun
así encabeza la lista. Sin él, la primera semana de pruebas repetidas contra
Places gasta crédito sin dejar rastro de en qué se fue. Y es el dato con el que
se decide, antes del 2026-10-07, si conviene convertir la cuenta de facturación.

El modo de fallo que previene es concreto: un field mask con `rating` de más
convierte una llamada Pro (5.000 gratis/mes) en Enterprise (1.000 gratis/mes)
sin que nada lo advierta.

---

## D-11 · La caracterización se apoya en `reviewSummary`, no en NLP propio — 2026-08-19

**Contexto.** El dueño pidió que cada estudio caracterice el tipo de negocio
"analizando hasta los comentarios", tomando como referencia su proyecto
`santo-domingo-restaurant-reviews-nlp`: 4.955 reseñas en español, sentimiento,
nubes de palabras, 500+ restaurantes.

Ese proyecto obtuvo el corpus con **Selenium**. Es scraping, y los ToS §3.2.3(a)
nombran *"user reviews"* literalmente entre lo prohibido. No se puede replicar.

**Los dos agentes discreparon.** `esodeja-pm` vetó descargar reseñas en
absoluto, incluso las que Places permite: con n≤5 por lugar, cualquier
porcentaje de sentimiento es ruido con apariencia de medición. `esodeja-maps`
encontró una tercera vía que el PM no conocía.

**Decisión.** Se adopta la vía de `esodeja-maps`, que satisface la petición del
dueño sin violar los ToS ni fabricar precisión falsa:

1. **`reviewSummary`** — Google produce él mismo la síntesis de las reseñas, en
   español, con **cobertura verificada de República Dominicana**. Se muestra en
   vivo, no se persiste, y lleva su `disclosureText` ("Resumido con Gemini") y
   su `reviewsUri` visibles, que son de exhibición obligatoria.
2. **Las reseñas literales se muestran como texto citado**, con
   `authorAttribution` y enlace a Google Maps. Para leerlas, no para agregarlas.
3. **No se calcula ningún porcentaje de sentimiento.** Ni por lugar, ni por
   zona, ni por estudio.
4. **No se persiste ningún texto de reseña ni derivado por lugar.**

**Por qué el veto del PM se revoca parcialmente.** Su razonamiento era correcto
sobre la premisa que tenía: que la única forma de usar reseñas era calcular
sentimiento. `reviewSummary` es una cuarta opción — síntesis producida por
Google, no derivada por nosotros — que no existía en su análisis. Su protección
central se conserva íntegra: **ningún porcentaje sobre muestra sesgada**.

**La aritmética que respalda el punto 3.** Con n=5 y p=0,5, el error estándar es
0,224 → intervalo al 95% de **±44 puntos porcentuales**. Un lugar "70% positivo"
es estadísticamente indistinguible de uno "30% positivo". Y la muestra no es
aleatoria: Google devuelve las 5 *"sorted by relevance"*, con una función no
documentada. Un sesgo desconocido no se corrige.

Nota incómoda: el 86,8% positivo del proyecto de referencia **tampoco es un
valor fiable**. Selenium raspa lo que la página renderiza, y Google también
ordena eso por relevancia. Es el mismo sesgo con más filas.

**Prohibido de forma nominal.** ToS §3.2.3(c)(vii) prohíbe usar contenido de
Maps para *"train, test, validate or fine-tune"* modelos. **No se puede
fine-tunear un clasificador de sentimiento en español dominicano sobre reseñas
de Google.** Esa era la ruta natural desde el proyecto de referencia y está
cerrada sin interpretación.

**Condición de reapertura.** Que Google publique una API de reseñas con volumen
y permiso de almacenamiento.

---

## D-12 · El eje cambia: de lo que dicen los clientes a lo que hacen los competidores — 2026-08-19

**Decisión.** El entregable de caracterización deja de ser *"qué opinan los
clientes"* y pasa a ser *"qué hacen los competidores y dónde están los huecos"*.

**Por qué.** Es lo que la API permite medir bien, y responde mejor la pregunta
que el dueño realmente tiene. `MASK_ATMOSPHERE` devuelve **30+ atributos
operativos verificados** por competidor: delivery, terraza, reservas, parking,
medios de pago, accesibilidad, franjas de servicio. El proyecto de referencia no
tenía nada de esto.

| Dimensión del proyecto NLP | En Esodeja | Veredicto |
|---|---|---|
| Densidad por barrio (15 barrios) | Conteo por anillo, excluyendo cerrados | **Mejor** — radios exactos desde el pin |
| Distribución de cocina | Mezcla de `primaryType` | **Equivalente y más limpia** — taxonomía cerrada |
| Segmentación de precio | `priceLevel` + `priceRange` **en DOP** | **Superior** — el original solo tenía el símbolo `$` |
| Rating por zona | `rating` + `userRatingCount` | **Superior** — parámetros poblacionales, sin error de muestreo |
| Sentimiento sobre 4.955 reseñas | `reviewSummary` + reseñas citadas | **Degradado** — cualitativo, no cuantificable |
| Nubes de palabras | — | **Imposible** — exige corpus almacenado |
| — | **Censo de 30+ atributos operativos** | **NUEVO** |
| — | **Tasa de cierre** vía `businessStatus` | **NUEVO** — mortalidad sectorial georreferenciada |

*"34 de 40 competidores hacen delivery; solo 6 tienen terraza; ninguno abre
desayunos"* es un output que Selenium nunca produjo y que responde directamente
a la pregunta de diferenciación.

**El resumen honesto para el dueño:** se pierde la nube de palabras; se gana el
mapa de huecos operativos y la tasa de cierre. Los dos proyectos no compiten —
el NLP fue un estudio retrospectivo de un sector, irrepetible legalmente;
Esodeja es una herramienta prospectiva sobre una ubicación, repetible.

---

## D-13 · Dos etiquetas de procedencia para datos de Google, no una — 2026-08-19

**Decisión.** Se separa `google-places` en dos etiquetas con reglas distintas:

| Etiqueta | Campos | Cómo se muestra |
|---|---|---|
| `google-places-censo` | `rating`, `userRatingCount`, `priceLevel`, `priceRange`, conteos, atributos, `businessStatus` | Como cifra. Entra en la proyección financiera |
| `google-places-muestra` | `reviews`, `reviewSummary`, `editorialSummary` | Como **texto citado**. Nunca como porcentaje |

**Por qué.** `rating` es la media de Google sobre **todas** las valoraciones del
lugar: un parámetro poblacional sin error de muestreo. `reviews` es una muestra
sesgada de tamaño 5. Darles la misma etiqueta invita a tratarlos con la misma
confianza, que es exactamente el fallo que `ranges-and-provenance` existe para
prevenir.

Todo lo etiquetado `google-places-muestra` lleva al lado, literal:

> **Muestra no representativa** — Google entrega un máximo de 5 reseñas por
> lugar, seleccionadas por su propio criterio de relevancia. Sirven como
> ilustración cualitativa. No se ha calculado ningún porcentaje sobre ellas.

---

## D-14 · Turf.js no toca coordenadas de Places — 2026-08-19

**Contexto.** D-4 eligió Turf.js para geometría y citó "punto-en-polígono" entre
sus usos. CLAUDE.md dice "operaciones espaciales con Turf.js".

**El problema.** ToS §3.2.3(c)(iv) lista como ejemplo explícitamente prohibido:

> *use latitude/longitude values from the Places API as an input for
> **point-in-polygon analysis***

La ruta de implementación obvia es la prohibida. Esto no se detectó al escribir
D-4 y habría entrado en el código sin que nadie lo notara.

**Decisión.** Tres reglas, ninguna de las cuales cuesta capacidad:

1. **La competencia se filtra por radio, nunca por polígono.** El
   `locationRestriction` circular de Nearby Search ya lo resuelve en el servidor
   de Google. No hay nada que hacer en Turf.
2. **Población alcanzable = polígono de isócrona ∩ geometría censal de la ONE.**
   El conjunto de puntos es de la ONE, no de Places: la cláusula no aplica.
3. **Nunca** pasar `places.location` a `turf.booleanPointInPolygon` ni a
   `turf.pointsWithinPolygon`.

**Verificación pendiente.** `esodeja-qa` debe añadir un test que falle si algún
fichero pasa un valor procedente de `lib/google/` a esas dos funciones de Turf.

---

## D-15 · Corrección de D-6: la isócrona es la partida más cara, no la más barata — 2026-08-19

**Contexto.** D-6 afirma que la isócrona "cuesta 1 llamada Pro por modo y
umbral".

**El error.** Compute Route Matrix **factura por elemento**, verbatim de Google:
*"billed per ELEMENT returned from the request. The number of elements is the
number of origins multiplied by the number of destinations."*

1 origen × 24 sondas = **24 elementos facturables**. La isócrona cuesta
**$0,120**, no $0,005 — un factor **24×**. Con dos modos de transporte y dos
umbrales son 96 elementos ($0,48), **más que todo el resto del estudio junto**.

**Decisión.** El método de D-6 se mantiene: sigue siendo asequible (416
estudios/mes dentro del umbral gratuito) y no hay alternativa. Lo que cambia es
que **el medidor de coste de E-3 debe contar elementos, no llamadas**.

Sin esa corrección, la reconciliación del ±20% contra Cloud Billing fallaría por
un factor 24 en esa partida, y se culparía a la tabla de precios en vez de al
medidor.

---

## D-16 · Google SÍ tiene Isochrones API — D-6 y D-15 quedan obsoletas — 2026-08-20

**Contexto.** D-6 se escribió sobre la premisa de que *"Google no tiene API de
isócronas"*, y por eso diseñó una aproximación por abanico radial de 24 sondas
contra Compute Route Matrix. D-15 corrigió su coste a $0,120 por elemento y la
declaró la partida más cara del producto.

**La premisa era falsa.** Google publicó una **Isochrones API**, detectada al
revisar la lista de APIs disponibles en el proyecto de Cloud del dueño.

| | Aproximación de D-6 | Isochrones API |
|---|---|---|
| Método | 24 sondas radiales + unión de puntos | Polígono real consciente de la red viaria |
| Exactitud | Aproximación, etiquetada como tal | Alcanzabilidad verdadera |
| Coste | $0,120 por isócrona (24 elementos) | **$0,00 durante Preview** |
| Llamadas | 1 Route Matrix por modo y umbral | 1 `GenerateIsochrone` |
| Modos | Los de Routes | `DRIVE`, `WALK`, `BICYCLE` |
| Límites | Los que pusiéramos | 3.600 s en DRIVE · 7.200 s en WALK/BICYCLE |

**Decisión.** Se adopta Isochrones API y se retira el abanico radial. Es
simultáneamente **más exacta y más barata** — no hay compromiso que evaluar.

**Consecuencias.**

1. **La UI deja de etiquetar la isócrona como aproximación.** Pasa a ser un dato
   real de red viaria. Esa etiqueta era honesta con el método anterior y sería
   engañosa con este.
2. **El coste por estudio baja de ~$0,42 a ~$0,30** mientras dure el Preview.
3. **E-13 se simplifica mucho.** Desaparece la generación de sondas, la unión de
   puntos y el manejo del truncamiento por umbral.
4. **D-14 sigue vigente.** El polígono que devuelve Google se intersecta con
   geometría censal de la ONE, no con coordenadas de Places.

**Dos riesgos que hay que aceptar explícitamente.**

- **Está en Preview (pre-GA).** Google declara soporte limitado y advierte de
  cambios incompatibles entre versiones pre-GA. Si rompe, el plan B es volver al
  método de D-6, que queda documentado y no se borra de este fichero.
- **Gratis solo durante Preview.** Al pasar a GA se factura por 1.000
  peticiones, dentro de los planes Essentials y Pro. El medidor de coste debe
  contemplar esa transición y no asumir $0 para siempre.

**Sin verificar.** La documentación **no declara cobertura por país**. Que
funcione en República Dominicana es un supuesto, no un hecho — exactamente el
tipo de supuesto que hundió al proyecto anterior con Overture. **Se verifica con
una llamada real en E-13 antes de construir nada encima**, y si no cubre RD se
vuelve a D-6 sin drama.
