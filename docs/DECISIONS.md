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
