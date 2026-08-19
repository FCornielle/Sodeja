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
| **E-4** | Competencia: Nearby Search a 250/500/1000 m. Conteos, rating medio, distribución de precio | `esodeja-maps` | pendiente |
| **E-5** | Portar `Money` / `Range` / `version` / `parameterInput` + sus tests | `esodeja-domain` | pendiente |
| **E-6** | Proyección mínima: capacidad → fit-out → opex → break-even, con constantes por defecto | `esodeja-domain` | pendiente |
| **E-7** | Pantalla única de resultado que muestre E-4 + E-6 | `esodeja-frontend` | pendiente |

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

**Coste por estudio:** ~9 llamadas Nearby Search Pro (3 radios × 3 categorías) +
~3 Enterprise en el radio de 250 m ≈ $0,40.

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
E-0 ✓ → E-1 → E-3 → E-2 → E-4 → E-5 → E-6 → E-7
```

Todo lo demás cuelga de tener el esqueleto vivo.

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
- **Places Insights**: cobertura de RD sin confirmar, requiere BigQuery con alta
  previa. Candidato a evaluar, no dependencia.

---

## Fechas de control

| Fecha | Qué |
|---|---|
| **2026-10-07** | Decidir conversión de la cuenta de facturación de Google Cloud |
| **~2026-10-21** | Expira el crédito de bienvenida de $300 |
| Al terminar el MVP | Respaldo (`git tag archive/sodeja-v1`) → confirmación → reemplazo del repo de GitHub |
