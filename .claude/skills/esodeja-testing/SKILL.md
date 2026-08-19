---
name: esodeja-testing
description: Convenciones de test de Esodeja — Vitest para dominio y Route Handlers, Playwright para E2E, fixtures de Google en vez de llamadas reales, y los tres tests de guardarraíl que protegen la factura, el cumplimiento legal y la reproducibilidad. Carga esta skill antes de escribir cualquier test o de cerrar un item del backlog.
---

# Convenciones de test de Esodeja

## 1. La regla dura: ningún test toca la red

**Cero llamadas reales a `googleapis.com` desde un test.** Ni una, ni siquiera
"solo para verificar que la integración funciona".

Dos razones, y la segunda pesa más de lo que parece:

1. Cada llamada gasta un crédito con fecha de caducidad. Una suite que corre
   en cada guardado puede consumir el presupuesto de un mes.
2. **Un test que depende de la red es un test que falla por razones que no son
   el código.** El proyecto anterior terminó con 5 tests en rojo, de los cuales
   3 eran timeouts contra una base local — ruido que enmascaraba los 2 fallos
   reales de lógica.

Las respuestas de Google se graban una vez como fixtures en `e2e/fixtures/` y
se reutilizan. Si hace falta una fixture nueva, la pide `esodeja-maps`, que
hace **una** llamada real y la guarda.

## 2. Estructura

| Capa | Herramienta | Dónde |
|---|---|---|
| `lib/domain/**` | Vitest, unidad | `lib/domain/*.test.ts`, junto al fuente |
| `app/api/**` | Vitest, integración con Google mockeado | `app/api/**/*.test.ts` |
| `lib/db/**` | Vitest contra SQLite **en memoria** | `lib/db/*.test.ts` |
| Recorrido completo | Playwright | `e2e/*.spec.ts` |

La base de datos de test es **en memoria**, nunca el fichero de desarrollo.
Que la suite exija un servicio externo vivo fue uno de los puntos de fricción
del proyecto anterior; aquí `npm test` corre sin nada más levantado.

## 3. Los tres tests de guardarraíl

Estos tres no verifican una funcionalidad: protegen una restricción del
proyecto. Se escriben una vez y se mantienen para siempre.

### El que protege la factura

Falla si una llamada declarada como tier **Pro** incluye un campo de tier
**Enterprise** (`rating`, `userRatingCount`, `priceLevel`,
`regularOpeningHours`, `nationalPhoneNumber`, `websiteUri`, `reviews`).

Un campo de más no encarece marginalmente: cambia el SKU y baja el umbral
gratuito de 5.000 a 1.000 llamadas/mes. Es el modo de fallo más caro del
proyecto y el más fácil de introducir sin notarlo.

### El que protege legalmente

Inspecciona el esquema de SQLite y falla si existe **cualquier columna que
almacene nombre, rating, número de reseñas, nivel de precio, horarios,
teléfono o foto de un lugar de Google**. Los Términos de Servicio solo
permiten almacenar `place_id` (indefinido) y coordenadas (≤30 días).

Acompañado del test del **reaper**: una coordenada con `cached_at` de hace 31
días desaparece al arrancar.

### El que protege la reproducibilidad

Golden file: mismo snapshot de inputs + misma `engineVersion` → mismo
resultado, byte a byte. Se porta desde
`../First Agentic Workflow/packages/calc/src/golden.test.ts`, que ya existe y
pasa.

Sin él, un reporte archivado deja de ser defendible en cuanto cambia un
parámetro del sistema.

## 4. Qué verificar en el dominio

- **Invariante de rango**: construir con `pessimistic > base` lanza.
- **Cruce de monedas**: sumar DOP con USD lanza, no computa.
- **Sin FX implícito**: ninguna función produce resultado en otra moneda sin
  recibir la tasa como argumento.
- **Nómina dominicana**: INFOTEP al 1% de nómina bruta; tabla salarial propia
  de restaurante (+25%); piso salarial seleccionado por tamaño de empresa
  derivado de headcount **y** ventas.
- **Errores explícitos**: si falta un parámetro, la función dice **cuál**
  falta. Un valor por defecto silencioso es peor que un error.

## 5. Qué verificar en la UI

El proyecto anterior tenía **4.567 líneas de interfaz con cero tests**. La
corrección no es "añadir algunos tests": es que **ninguna pantalla se cierra
sin E2E**.

Cada pantalla necesita su camino feliz **y al menos un estado degradado**:

| Estado | Qué se verifica |
|---|---|
| Cero resultados | Dice **"sin cobertura"** con esas palabras, no un cero silencioso |
| Conteo truncado | Muestra `20+`, nunca `20` |
| Presupuesto agotado | Muestra el aviso y el modo degradado, no un error genérico |
| Dato con advertencia de calidad | La advertencia aparece **junto al número**, no en un pie |
| Supuesto editado | Lo que depende de él se marca obsoleto, visiblemente |

Los estados vacíos no son casos borde en este producto: un cero de Google y un
cero real significan cosas opuestas para el usuario, y confundirlos le hace
tomar una mala decisión de negocio.

## 6. Cómo se cierra un item

Un item está cerrado cuando, y solo cuando:

1. Sus tests pasan.
2. `npm run typecheck` y `npm run lint` están limpios.
3. Los criterios de aceptación de `esodeja-pm` se cumplen, comprobados
   literalmente uno a uno.

Si un criterio no se puede comprobar, **no se aprueba por aproximación**: se
devuelve a `esodeja-pm` para que lo reescriba de forma verificable.

## 7. Reportar sin suavizar

Si algo falla, se dice con la salida real del comando. Si un item está a
medias, se dice qué parte falta. Un "listo" que no es cierto cuesta más que un
fallo reportado a tiempo — el README del proyecto anterior prometía `pnpm dev`
como quickstart cuando la API ni siquiera tenía script `dev`, y eso sobrevivió
meses sin que nadie lo notara.
