# Esodeja

Herramienta de **estudios de mercado geográficos para República Dominicana**,
de **un solo usuario**, construida sobre Google Maps Platform.

Pones un pin sobre un local en Santo Domingo o Santiago y obtienes: competencia
georreferenciada por radio, población alcanzable por isócrona, capacidad
estimada, costo de fit-out, opex con nómina dominicana real, proyección
financiera con break-even, y un reporte exportable. Todo como rangos editables
con procedencia visible.

## Qué NO es este proyecto

Rechaza trabajo en estas áreas — están fuera por decisión del dueño:

- Autenticación, multi-usuario, RLS, roles, aislamiento de datos.
- App Android o iOS nativa. Es responsive y se usa desde el navegador.
- Docker, Postgres, PostGIS, servicios Python, CMS, panel de administración.
- Datos de tráfico peatonal: **no existen para RD a ningún precio
  practicable**. No los prometas.

## Arquitectura

Una sola app Next.js 15 (App Router), un solo `package.json`, SQLite en
fichero. `npm run dev` arranca **todo** — no hay demonio que levantar.

```
app/            Pantallas (Server Components por defecto) + Route Handlers en app/api/
components/     UI
lib/google/     TODO lo que llama a googleapis.com. Frontera de esodeja-maps
lib/domain/     Motor de cálculo. PURO: sin I/O, sin red, sin DB
lib/db/         SQLite (better-sqlite3), migraciones, reaper de retención
lib/schemas/    Contratos Zod. Solo esodeja-architect los define
data/           Base SQLite, seeds, ficheros estáticos de censo y geometría
docs/           BACKLOG.md, DECISIONS.md, adr/, sources/
e2e/            Playwright + fixtures de Google
```

Operaciones espaciales con **Turf.js en JavaScript**, no en SQL.

## Las cuatro reglas que no se rompen

### 1. Las claves

| Variable | Ámbito |
|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY` | Navegador. Solo Maps JS API. Restringida por referrer |
| `GOOGLE_MAPS_SERVER_KEY` | **Solo servidor.** Nunca en un componente cliente, nunca con prefijo `NEXT_PUBLIC_` |

El navegador nunca llama a Places, Routes ni Geocoding directamente. Siempre a
través de un Route Handler propio.

### 2. Los field masks deciden la factura

En Places API (New), `X-Goog-FieldMask` determina el tier de facturación.
Añadir `rating` o `priceLevel` sube la llamada de Pro (5.000 gratis/mes) a
Enterprise (**1.000 gratis/mes**).

Las máscaras son constantes en `lib/google/fieldMasks.ts`. **Nunca inline,
nunca concatenadas dinámicamente.** Hay un test que falla si una llamada Pro
incluye un campo Enterprise.

### 3. Los ToS de Google definen el esquema de datos

Restricción legal, no estética:

- `place_id` → almacenable **indefinidamente**.
- Coordenadas → caché **máximo 30 días**, con `cached_at` y reaper.
- Nombre, rating, reseñas, precio, horarios, teléfono, fotos → **jamás tocan la
  base de datos**. Se piden en vivo.
- Métricas agregadas propias → sí, son análisis nuestro.

Si vas a crear una columna `name` o `rating` para un lugar de Google, para.

### 4. Rangos, nunca puntos

Todo valor estimado es `{pessimistic, base, optimistic}` con etiqueta de
procedencia visible (`usuario` / `referencia sectorial` / `estimado` /
`google-places`). Todo dinero es `Money = {amount, currency}` — nunca un
`number`. Sumar monedas distintas lanza. **Nunca hay conversión FX implícita**:
la tasa es un input explícito y editable.

## Agentes

Ocho agentes en `.claude/agents/`, con fronteras disjuntas:

| Agente | Frontera |
|---|---|
| `esodeja-pm` | `docs/BACKLOG.md`, `docs/DECISIONS.md`. Veto sobre abstracción prematura |
| `esodeja-architect` | `lib/schemas/**`, `lib/db/schema.sql`, `docs/adr/**` |
| `esodeja-maps` | `lib/google/**`, `app/api/google/**`. **Único** autorizado a llamar a googleapis.com |
| `esodeja-domain` | `lib/domain/**`. Puro |
| `esodeja-frontend` | `app/**` (no `app/api/`), `components/**` |
| `esodeja-data` | `lib/db/**`, `data/**` |
| `esodeja-qa` | `**/*.test.ts`, `e2e/**` |
| `esodeja-dr-research` | `docs/sources/**`. Verifica cifras dominicanas contra fuentes primarias |

Cuatro skills en `.claude/skills/`: `google-maps-platform`, `dr-market-data`,
`ranges-and-provenance`, `esodeja-testing`. **Cárgalas** — contienen los
precios, las citas legales y las trampas conocidas.

## Antecedente: por qué existe este repo

Esodeja reemplaza a SODEJA (`../First Agentic Workflow/`, también en
`github.com/FCornielle/Sodeja`), que acumuló ~19.000 líneas de código de buena
calidad, 406 tests y 26 endpoints funcionales — **y nunca produjo un solo
estudio de mercado**.

No falló por ejecución. Falló por una regla puesta al inicio y nunca revisada:
*"ningún servicio de pago será aprovisionado"*. De ahí salieron cuatro
agujeros: el mapa nunca tuvo tiles (su propio código se describía como
*"UNVERIFIED placeholder"*), el proveedor de POI lanzaba `NOT_CONFIGURED`
siempre, los adaptadores de Google Places estaban escritos y **nunca se
ejecutaron**, y el peso operativo (monorepo de 12 workspaces, Docker, PostGIS)
hacía cada iteración lenta.

Ese repo es la cantera de la que se porta el activo real: la **curación de
datos dominicanos verificados**. El código se descarta.

**Regla de oro heredada de ese fracaso:** vertical antes que horizontal. Nada
se abstrae hasta tener dos implementaciones reales. Ningún sprint cierra sin
que el recorrido completo funcione de punta a punta.

## Comandos

```bash
npm run dev        # arranca todo en :3000
npm test           # Vitest. Ningún test toca la red
npm run test:e2e   # Playwright con Google mockeado
npm run typecheck
npm run lint
```

## Fechas de control

| Fecha | Qué |
|---|---|
| **2026-10-07** | Decidir conversión de la cuenta de facturación de Google Cloud |
| **~2026-10-21** | Expira el crédito de bienvenida de $300 |

Si el trial expira sin convertir, Google **cierra la cuenta y detiene los
recursos**. Convertir no implica gastar: los $200/mes recurrentes siguen
aplicando y por debajo de ese umbral la factura es cero.
