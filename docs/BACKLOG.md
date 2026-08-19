# Backlog de Esodeja

Dueño: `esodeja-pm`. Estados: `pendiente` · `en curso` · `hecho` · `bloqueado`.

**Regla de sprint:** ningún sprint cierra sin que el recorrido completo funcione
de punta a punta. Feo es aceptable; incompleto no.

**Regla de coste:** todo item que añada llamadas a Google declara cuántas
introduce por estudio y de qué tier. Un item que no lo declare no está listo
para empezar.

---

## Sprint 0 — Fundamentos

| ID | Item | Agente | Estado |
|---|---|---|---|
| **E-0** | Scaffold Next.js 15 + TS + Zod + SQLite + Vitest + Playwright; 8 agentes y 4 skills en `.claude/`; `.env.local.example` | — | **hecho** |
| **E-1** | Habilitar las 8 APIs en Cloud; dos claves con restricciones opuestas; presupuesto y alerta en Cloud Billing; `/api/health/google` | `esodeja-maps` | **bloqueado** — requiere Project ID y claves del dueño |

### E-0 — criterios de aceptación

- [x] `npm run dev` levanta en `:3000` sin ningún servicio externo.
- [x] `npm test` en verde (13 tests).
- [x] `npm run typecheck` y `npm run build` limpios.
- [x] La portada reporta el estado de configuración sin exponer ningún secreto.
- [x] Existe un test que verifica que `configStatus()` nunca filtra el valor de
      `GOOGLE_MAPS_SERVER_KEY`.

### E-1 — criterios de aceptación

- [ ] `GET /api/health/google` devuelve OK por cada API habilitada, y un error
      nombrando la API concreta cuando una falta.
- [ ] La clave de navegador está restringida por referrer y **solo** a Maps JS.
- [ ] La clave de servidor no tiene restricción de referrer y está limitada al
      conjunto exacto de APIs.
- [ ] Hay alerta de presupuesto configurada en Cloud Billing.

**Coste:** 1 llamada mínima por API, una sola vez. Despreciable.

---

## Sprint 1 — El esqueleto que camina

> **Criterio de aceptación del sprint:** poner un pin en una dirección real de
> Santo Domingo y obtener un estudio completo end-to-end. Con supuestos por
> defecto, sin editar nada. **Pero completo.**

| ID | Item | Agente | Estado |
|---|---|---|---|
| **E-3** | Medidor de coste + presupuesto duro + badge en pantalla | `esodeja-maps` | pendiente |
| **E-2** | Mapa Google + búsqueda de dirección + pin + polígono a mano + área | `esodeja-maps` + `esodeja-frontend` | pendiente |
| **E-20** | Taxonomía de los cinco tipos de negocio y su mapeo verificado a `includedTypes` de Places | `esodeja-architect` + `esodeja-domain` | pendiente |
| **E-4** | Competencia: Nearby Search a 250/500/1000 m. Conteos, rating medio, distribución de precio | `esodeja-maps` | pendiente |
| **E-5** | Portar `Money` / `Range` / `version` / `parameterInput` + sus tests | `esodeja-domain` | pendiente |
| **E-6** | Proyección mínima: capacidad → fit-out → opex → break-even, con constantes por defecto | `esodeja-domain` | pendiente |
| **E-7** | Pantalla única de resultado que muestre E-4 + E-6 | `esodeja-frontend` | pendiente |

### E-20 — criterios de aceptación

**Va antes de E-4**, porque E-4 no se puede implementar sin saber qué
`includedTypes` pedir. No es alcance nuevo: es alcance que E-4 ya necesitaba y
que estaba escrito de forma vaga ("3 categorías", sin decir cuáles).

- [ ] `lib/schemas/businessType.ts` exporta un enum Zod con **exactamente
      cinco** valores: `restaurante`, `colmado`, `ferreteria`, `salon_belleza`,
      `minimarket`. Añadir un sexto exige entrada en `docs/DECISIONS.md`.
- [ ] Cada tipo declara: `includedTypes` de Places, `excludedTypes` si aplica,
      radio de decisión por defecto en metros, y banda de plausibilidad de
      densidad esperada por km².
- [ ] Existe `data/places-types.json` con la lista oficial de tipos de Places y
      su fecha de descarga. Un test falla si algún `includedType` declarado no
      está en ese fichero.
- [ ] Cada mapeo se verificó con **una llamada real** en Santo Domingo y el
      conteo devuelto se anotó en el commit. Un mapeo que devuelva cero se marca
      `sin cobertura`, no se acepta en silencio.
- [ ] **La colisión colmado / minimarket está documentada en el módulo.** Ambos
      caen bajo `convenience_store` / `grocery_store`: Google no distingue el
      formato dominicano de colmado. Se miden como **un solo bucket**, se
      muestran como fila combinada, y solo se separan si el usuario lo declara.
      Resolverlo con un clasificador sería inventar el servicio de ML que está
      fuera de alcance.
- [ ] **No hay registry, ni plugin, ni carga dinámica, ni interfaz de tipo de
      negocio.** Es un objeto literal. Un test cuenta cinco entradas y falla si
      el módulo exporta una función de registro.

**Coste:** 5 llamadas Nearby Search Pro, **una sola vez**, para verificar los
mapeos. **Cero coste por estudio** — E-20 no añade llamadas, acota las de E-4.

**E-3 va primero, por delante de E-2 y E-4.** Es el único item del sprint que no
produce valor visible, y aun así encabeza la lista: sin él, la primera semana de
pruebas repetidas contra Places gasta crédito sin dejar rastro de en qué.

### E-4 — el item que decide el producto

Aquí se responde la pregunta existencial: **¿tiene Google Places cobertura real
de negocios en Santo Domingo y Santiago?**

Criterio de aceptación: con el pin en Av. Winston Churchill esquina Gustavo
Mejía Ricart y la categoría `restaurante`, la pantalla muestra un conteo
distinto de cero para los tres radios, y el badge de coste marca entre $0,10 y
$0,60. Si Google devuelve cero resultados, la UI dice **"sin cobertura"** con
esas palabras — no un cero silencioso, que el usuario leería como "no hay
competencia" cuando significa "no hay datos".

Si este item falla, el producto no es viable tal como está concebido y hay que
replantear antes de gastar un sprint más.

**Coste por estudio (corregido 2026-08-19):** `includedPrimaryTypes` acepta
hasta 50 tipos por llamada y `primaryType` viene en la respuesta, así que **una
llamada cubre todas las categorías a la vez** — no hacen falta 3 radios × 3
categorías. Con la fusión de máscaras de D-11, son **6 llamadas Nearby Search
Enterprise ≈ $0,210**, no 12 llamadas por $0,40. La banda del criterio de
aceptación ($0,10–$0,60) sigue valiendo.

**Criterio de aceptación añadido — verificar un supuesto no verificado:** la
misma llamada debe confirmar que **Nearby Search puebla `places.reviews`** para
cada lugar devuelto. La documentación lo sugiere pero no lo garantiza, y toda la
ventaja de coste de 12,5× frente a Place Details descansa en ese supuesto.
Cuesta $0,04 comprobarlo y responde tres preguntas de golpe: si hay cobertura de
negocios en RD, si Nearby devuelve reseñas en bloque, y si `reviewSummary` llega
de verdad en español para lugares dominicanos.

Si resulta que no las puebla, el plan B es degradado pero viable: `reviewSummary`
y atributos vía Nearby (son campos escalares del lugar), y reseñas literales solo
para el local del usuario vía Place Details.

---

## Sprint 2 — Que los números sean creíbles

| ID | Item | Agente | Estado |
|---|---|---|---|
| **E-8** | Portar reglas y los 5 seeds dominicanos; traducir dialecto Postgres → SQLite | `esodeja-data` | pendiente |
| **E-9** | Nómina real: TSS + INFOTEP 1% + salario mínimo por tamaño de empresa + tabla propia de restaurantes | `esodeja-domain` | pendiente |
| **E-10** | Editor de supuestos: procedencia, banda de plausibilidad, invalidación aguas abajo | `esodeja-frontend` | pendiente |
| **E-11** | Proyección completa: escenarios, sensibilidad, break-even como rango. **Tasa FX como input explícito** | `esodeja-domain` | pendiente |
| **E-12** | Checklist de permisos DN + Santiago, encuadre no exhaustivo | `esodeja-domain` | pendiente |

**E-11 arregla un bug heredado:** en el proyecto anterior la proyección lanzaba
409 si la tasa `fx_usd_dop` no estaba fijada, y ningún endpoint la fijaba nunca.
Toda la proyección USD↔DOP quedó inalcanzable. La tasa es un supuesto de primera
clase del formulario, no una precondición oculta.

**Coste:** cero llamadas nuevas a Google.

---


---

## Sprint 2B — Caracterización del tipo de negocio

> **Criterio de aceptación del sprint:** con el pin puesto y un tipo elegido, la
> pantalla muestra el perfil medido de ese tipo en la zona, con `n`, fecha y
> confianza en cada cifra, y el bloque **"Alcance de esta medición"** visible.
> Sin ninguna llamada nueva a Google respecto al Sprint 1, salvo la comparativa.

**Por qué va después del Sprint 2 y no dentro del Sprint 1** (ver D-12):

1. **E-4 responde la pregunta existencial.** Si Google tiene cobertura pobre de
   ferreterías y salones en Santiago, o si los radios saturan el tope de la API
   en cada barrido de Piantini, estos items cambian de forma o mueren.
   Construirlos antes sería construir contra un supuesto no verificado — el
   error exacto de SODEJA con Overture.
2. **La regla vertical protege al Sprint 1, no lo amplía.** La caracterización
   enriquece una pantalla que aún no existe.
3. **Es barato porque llega tarde.** E-21, E-22, E-23 y E-25 tienen **coste cero
   en llamadas nuevas**: derivan y presentan datos que E-4 ya paga. Esa
   gratuidad solo existe porque el barrido ya está construido.

| ID | Item | Agente | Estado |
|---|---|---|---|
| **E-21** | Métricas de caracterización derivadas del barrido de E-4 | `esodeja-domain` | pendiente |
| **E-22** | Suficiencia muestral, confianza y supresión | `esodeja-domain` | pendiente |
| **E-23** | Pantalla de caracterización + bloque "Alcance de esta medición" | `esodeja-frontend` | pendiente |
| **E-24** | Comparativa entre tipos candidatos sobre el mismo pin | `esodeja-maps` + `esodeja-frontend` | pendiente |
| **E-25** | Ficha nominal en vivo + `reviewSummary` de competidores a 250 m | `esodeja-frontend` | pendiente |

### E-21 — criterios de aceptación

- [ ] Función pura `characterize(places, radiusM, businessType, measuredAt)` en
      `lib/domain/`. Sin fetch, sin DB, sin `Date.now()` no inyectado. Un test
      de frontera falla si el módulo importa algo de `lib/google/`.
- [ ] Devuelve siete métricas: conteo, densidad/km², mix de subtipos,
      distribución de rating, distribución de precio, mediana de
      `userRatingCount`, y **tasa de cierre**.
- [ ] La densidad coincide con `conteo / (π r² en km²)`, verificado a mano en el
      test para r = 250, 500 y 1000.
- [ ] El rating sale como `{p25, mediana, p75}` con procedencia
      `google-places-censo`. **Un test falla si el objeto de salida contiene
      alguna clave `mean`, `average` o `promedio` para rating** (ver D-13).
- [ ] El precio sale como `{distribucion, coberturaPct}`. Con un fixture donde 3
      de 18 lugares traen `priceLevel`, `coberturaPct` es `16.7`.
- [ ] `businessStatus` produce `tasaCierrePct`, y se devuelven **dos** conteos:
      bruto y operativo (excluyendo `CLOSED_PERMANENTLY`), cada uno etiquetado.
      Es la señal que el proyecto de referencia no tenía: mortalidad sectorial
      georreferenciada.
- [ ] Si el conteo igualó el tope de `maxResultCount`, la salida marca
      `truncado: true` y toda ratio derivada sale como **cota inferior**.
- [ ] Todo valor lleva procedencia y `measuredAt`.

**Coste: 0 llamadas nuevas.** Consume lo que E-4 ya paga.

### E-22 — criterios de aceptación

- [ ] Toda métrica sale envuelta en
      `{valor, n, coberturaPct, confianza, suprimida, motivo}`.
- [ ] `n < 5` → `suprimida: true`, motivo `muestra insuficiente (n=3)` con el n
      real interpolado. El valor no se expone en el objeto público.
- [ ] `5 ≤ n < 15` → confianza `baja`, solo forma de rango. Un test verifica que
      no se puede construir una métrica puntual con confianza baja.
- [ ] `n ≥ 15` → confianza `media`. **El enum de confianza no contiene `alta`.**
      Un test lo verifica. Ningún dato de Places en RD justifica esa etiqueta.
- [ ] `coberturaPct < 50` → suprimida, con motivo que nombra el porcentaje real:
      `Google no publica precio para el 83% de los locales medidos`. El negativo
      es más difícil de malinterpretar que el positivo con caveat.
- [ ] Radio truncado → toda ratio que use ese conteo sale suprimida o como cota.
- [ ] Para cada métrica de E-21 hay un caso que la suprime y otro que la deja
      pasar.

**Coste: 0 llamadas.**

### E-23 — criterios de aceptación

- [ ] Con el pin en Av. Winston Churchill esquina Gustavo Mejía Ricart y el tipo
      `restaurante`, la sección **Caracterización** muestra las siete métricas
      para los radios 250 / 500 / 1000 m.
- [ ] Cada métrica muestra, **visible y no en tooltip**: el rango, la etiqueta de
      procedencia, la fecha de medición y `n=`.
- [ ] Una métrica suprimida muestra su motivo literal. No un guion, no un cero,
      no un espacio en blanco.
- [ ] Un conteo truncado se lee `20+`. Un test E2E con fixture saturado falla si
      el DOM contiene `20` sin el `+`.
- [ ] Existe un bloque fijo, siempre visible, titulado **"Alcance de esta
      medición"** (texto abajo), reproducido también en el reporte impreso.
- [ ] Las cadenas `sentimiento`, `análisis de sentimiento`, `opinión` y `nube de
      palabras` **no aparecen en ningún punto de la UI**. Test E2E que hace grep
      del DOM del recorrido completo. Si el vocabulario del proyecto NLP aparece,
      el usuario importa sus expectativas.

**Coste: 0 llamadas nuevas.**

### E-24 — criterios de aceptación

- [ ] Con el pin fijado, el botón **"Comparar tipos"** lanza **un solo barrido**:
      1 llamada Nearby Search Pro por tipo, a **un único radio** (el de decisión,
      500 m por defecto). Máximo cinco tipos.
- [ ] La tabla muestra por tipo: conteo (o `N+`), densidad/km², tasa de cierre y
      confianza. **Ningún ranking automático, ninguna recomendación, ninguna
      puntuación agregada.** La herramienta muestra; el dueño decide.
- [ ] El badge de coste muestra el importe exacto **antes** de ejecutar y pide
      confirmación si el estudio superaría $1,00.
- [ ] Colmado y minimarket aparecen como **una sola fila combinada**, con la nota
      de colisión de E-20 al lado del número.
- [ ] Relanzar exige confirmación explícita. No se re-ejecuta al navegar, al
      recargar ni al montar el componente. Un test E2E verifica que dos renders
      producen una sola llamada.
- [ ] Un tipo que devuelva cero dice **"sin cobertura"** con esas palabras.

**Coste por estudio:** hasta 5 llamadas Nearby Search Pro ≈ **$0,16**. Cero
Enterprise. Un estudio con comparativa queda en ~$0,58 total.

### E-25 — criterios de aceptación

- [ ] La sección lista hasta 20 competidores del radio de 250 m con nombre,
      rating, nº de reseñas, nivel de precio, rango de precio en DOP y estado
      operativo.
- [ ] Muestra el **`reviewSummary` de Google en español** por competidor, con su
      `disclosureText` ("Resumido con Gemini") y su enlace `reviewsUri`
      **visibles** — son de exhibición obligatoria.
- [ ] Muestra las reseñas literales como **texto citado**, con
      `authorAttribution` y enlace a Google Maps. Junto a ellas, la etiqueta
      literal de D-13: *"Muestra no representativa — Google entrega un máximo de
      5 reseñas por lugar, seleccionadas por su propio criterio de relevancia.
      Sirven como ilustración cualitativa. No se ha calculado ningún porcentaje
      sobre ellas."*
- [ ] **Ningún porcentaje, gráfico ni score se calcula sobre las reseñas.** Test
      E2E que verifica que la sección no contiene el carácter `%` junto a texto
      de reseña.
- [ ] Todo se pide **en vivo** en cada render. El test de esquema de D-9 falla si
      aparece cualquier columna que persista nombre, rating, reseñas o precio.
- [ ] Lo único persistido es el conjunto de `place_id` y, con `cached_at`, las
      coordenadas.
- [ ] Al reabrir un estudio archivado sin re-consultar, la sección dice **"lista
      nominal no disponible sin re-consultar (coste: $0,04)"** y ofrece un botón.
      No muestra lista vacía ni datos rancios.
- [ ] Un lugar con `businessStatus` cerrado se muestra **marcado como cerrado**,
      no se oculta. Ocultarlo falsearía la tasa de cierre de E-21.

**Coste por estudio: 0 llamadas nuevas** — reutiliza la llamada
Enterprise + Atmosphere que E-4 ya paga. Re-consultar un archivado: ≈ $0,04.

### El bloque "Alcance de esta medición"

Fijo, siempre visible en la pantalla de caracterización y reproducido en el
reporte impreso (E-16). Texto para pegar tal cual:

> **Alcance de esta medición**
>
> Esta caracterización se construyó con **N establecimientos** observados en
> Google Places el **[fecha]**, dentro de los radios indicados alrededor del pin.
>
> **Lo que sí mide:** cuántos negocios de este tipo hay, cómo se reparten en el
> espacio, qué proporción figura como cerrada, qué servicios ofrecen, y cómo se
> distribuyen su valoración y su nivel de precio **entre los locales para los que
> Google publica ese dato**.
>
> **Lo que no mide:** no cuantifica el contenido de las reseñas. No mide
> satisfacción, calidad ni percepción de los clientes. No mide facturación,
> tráfico de personas ni cuota de mercado. No es un censo de la ciudad: solo
> observa el entorno de este pin.
>
> Google no publica todos los campos para todos los locales, y un radio muy denso
> puede devolver una lista truncada. Cuando eso ocurre, la cifra se muestra como
> **cota inferior (`N+`)** o se suprime. **Una cifra suprimida no significa cero:
> significa que no hay base para afirmarla.**
## Sprint 3 — Accesibilidad y población

| ID | Item | Agente | Estado |
|---|---|---|---|
| **E-13** | Isócronas aproximadas a pie y en coche (5/10/15 min), abanico radial + Route Matrix, etiquetadas como aproximación | `esodeja-maps` | pendiente |
| **E-14** | Población alcanzable: OCHA COD-AB + Censo ONE 2022 como ficheros estáticos; intersección con Turf | `esodeja-data` | pendiente |
| **E-15** | Índice de demanda = población / competidores, con niveles de confianza y supresión por cobertura insuficiente | `esodeja-domain` | pendiente |

**E-13:** Google no tiene API de isócronas. Es una aproximación por sondas
radiales y la UI debe decirlo. **Coste:** 1 llamada Route Matrix Pro por modo y
umbral ≈ 2 por estudio.

**E-14:** el censo ONE 2022 tiene **20,6% de omisión de hogares**, la peor en 20
años, sesgada hacia Santiago y Santo Domingo. La advertencia se muestra junto al
número, no en un pie de página.

---

## Sprint 4 — Reporte y pulido

| ID | Item | Agente | Estado |
|---|---|---|---|
| **E-16** | Reporte imprimible: mapa estático + Street View + tablas + procedencias + fecha + disclaimer | `esodeja-frontend` | pendiente |
| **E-17** | Historial de estudios + reaper de retención de 30 días | `esodeja-data` | pendiente |
| **E-18** | Suite E2E Playwright del recorrido completo con Google mockeado | `esodeja-qa` | pendiente |
| **E-19** | *Opcional:* Aerial View para contexto visual | `esodeja-maps` | pendiente |

---

## Ruta crítica

```
E-0 ✓ → E-1 → E-3 → E-2 → E-20 → E-4 → E-5 → E-6 → E-7
                             ↑
                    E-20 es dependencia dura de E-4
```

Todo lo demás cuelga de tener el esqueleto vivo. Sprint 2B (E-21 … E-25) va
después del Sprint 2 — ver D-12 para la justificación.

---

## Fuera de alcance

Rechazado por decisión del dueño. No reabrir sin decisión explícita:

- Autenticación, multi-usuario, RLS, roles, aislamiento de datos.
- Aceptación de ToS versionada, consentimiento Ley 172-13, export/delete RGPD.
- App Android o iOS nativa.
- Servicio Python de geo/ML, visión por computador.
- CMS de contenido, panel de administración.
- Docker, Postgres, PostGIS.
- **Datos de tráfico peatonal**: no existen para RD a ningún precio practicable.
- **Análisis de sentimiento y NLP sobre reseñas** (D-11): el techo legítimo son 5
  reseñas por lugar, en tier Enterprise + Atmosphere, y el texto no es
  almacenable. Con n=5 el intervalo al 95% es de ±44 puntos porcentuales.
- **Nubes de palabras y extracción de términos**: requieren persistir texto de
  reseñas. Prohibido por ToS §3.2.3(a)(iii), que nombra *user reviews* literal.
- **Fine-tuning de un clasificador sobre reseñas de Google**: prohibido de forma
  nominal por ToS §3.2.3(c)(vii).
- **Inventario censal de la ciudad por barrios**: Esodeja es pin-céntrico. Barrer
  15 barrios × 5 tipos agota el umbral gratuito mensual y no mejora la decisión
  sobre un local concreto.
- **Places Insights**: cobertura de RD sin confirmar, requiere BigQuery con alta
  previa. Candidato a evaluar, no dependencia.

---

## Fechas de control

| Fecha | Qué |
|---|---|
| **2026-10-07** | Decidir conversión de la cuenta de facturación de Google Cloud |
| **~2026-10-21** | Expira el crédito de bienvenida de $300 |
| Al terminar el MVP | Respaldo (`git tag archive/sodeja-v1`) → confirmación → reemplazo del repo de GitHub |
