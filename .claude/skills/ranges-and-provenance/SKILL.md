---
name: ranges-and-provenance
description: La postura numérica de Esodeja — rangos de tres puntos en vez de estimaciones puntuales, etiquetas de procedencia obligatorias, bandas de plausibilidad, invalidación aguas abajo al editar un supuesto, y la regla de moneda explícita sin conversión FX implícita. Carga esta skill antes de diseñar, calcular o mostrar cualquier número que llegue al usuario.
---

# Rangos y procedencia

La regla que gobierna todo número en Esodeja: **ningún valor estimado se
muestra como punto, y ningún valor se muestra sin decir de dónde viene.**

## 1. Por qué

Esodeja estima cosas que nadie ha medido con rigor en República Dominicana:
cuánto cuesta montar un local por metro cuadrado, cuánta gente pasa por una
esquina, cuánto factura un colmado. No existe la fuente autoritativa.

Un producto honesto en ese contexto tiene dos opciones: no dar el número, o
darlo como rango con su procedencia visible. La tercera opción — dar un punto
con tres decimales y buena tipografía — produce **confianza injustificada**, y
es exactamente lo que convierte una herramienta de análisis en una máquina de
malas decisiones.

El proyecto anterior llegó a esta conclusión tras verificar sus propias
fuentes y descubrir que las cifras de fit-out de RD$30-45k/m² que iba a usar
**estaban mal atribuidas y venían de blogs inmobiliarios**. La postura de
rangos no es cautela decorativa: es la respuesta a un hallazgo concreto.

## 2. La forma canónica

```ts
type Range<T> = { pessimistic: T; base: T; optimistic: T };
type Money = { amount: number; currency: 'DOP' | 'USD' };
type MoneyRange = Range<Money>;
```

**Invariante, verificada al construir:** `pessimistic <= base <= optimistic`.
Un constructor que reciba valores fuera de orden lanza; no los reordena en
silencio.

Estos tipos se portan desde
`../First Agentic Workflow/packages/calc/src/{range,money}.ts`, donde ya
existen con tests pasando. No los reescribas de cero.

## 3. Procedencia: las cuatro etiquetas

Todo valor lleva una y solo una:

| Etiqueta | Significa | Ejemplo |
|---|---|---|
| `usuario` | Lo introdujo el usuario | Metros cuadrados medidos en sitio |
| `referencia sectorial` | De una fuente sectorial citada, con fecha | Ratio de cubiertos por m² de restaurante |
| `estimado` | Derivado por el motor a partir de otros valores | Break-even calculado |
| `google-places` | Medido en vivo contra Google, con fecha de medición | Conteo de competidores a 500 m |

Un valor sin etiqueta no está listo para mostrarse. En la UI la etiqueta es
**visible**, no un tooltip escondido.

### Las etiquetas viajan con el dato, no con la pantalla

Si un valor `referencia sectorial` alimenta un cálculo, el resultado es
`estimado`, y su trazabilidad debe permitir llegar hasta la cita original. Una
proyección financiera cuya cadena de procedencia se rompe a mitad no es
defendible.

## 4. Bandas de plausibilidad

Cada parámetro editable declara el rango dentro del cual un valor es
razonable. Si el usuario introduce algo fuera de la banda, la UI **avisa pero
no bloquea** — el usuario puede saber algo que el modelo no sabe.

Lo que no se hace: aceptar en silencio un alquiler de RD$50 por m² y
propagarlo hasta un break-even de dos semanas sin decir nada.

## 5. Invalidación aguas abajo

Editar un supuesto marca como **obsoleto** todo lo calculado a partir de él,
visualmente y de inmediato. El usuario tiene que ver qué se ha quedado viejo.

Esto se identificó tarde en el proyecto anterior (era el item `B-11a`, añadido
después de que el backlog ya estuviera cerrado) y por eso llegó mal integrado.
Aquí es requisito desde el diseño del modelo de datos, no un añadido.

## 6. Moneda: las tres reglas

1. Todo valor monetario es `Money = {amount, currency}`. **Nunca** un `number`
   tratado como dinero.
2. Sumar o comparar monedas distintas **lanza error**. No se computa a través
   de monedas en silencio.
3. **Nunca hay conversión FX implícita.** Si un cálculo necesita una tasa, la
   tasa es un input explícito, editable y trazable — jamás una constante
   hardcodeada ni un valor asumido.

### El bug a no repetir

En el proyecto anterior, `finance.service.ts` lanzaba 409 si la tasa
`fx_usd_dop` no estaba fijada, y **ningún endpoint la fijaba nunca**. Toda la
proyección USD↔DOP quedó inalcanzable en la práctica: una regla correcta
implementada como precondición oculta en vez de como campo del formulario.

La tasa FX es un supuesto de primera clase, con valor por defecto editable y
procedencia `usuario`. No una puerta cerrada.

## 7. Reproducibilidad

Todo resultado persistido guarda `engineVersion` más un **snapshot completo de
sus inputs**. Mismo snapshot + misma versión → mismo resultado, byte a byte,
meses después.

Sin esto, un reporte archivado es indefendible: no puedes explicar de dónde
salió un número si los parámetros que lo produjeron ya cambiaron.

## 8. Cómo se ve mal, y cómo se ve bien

**Mal:**
> Inversión inicial: RD$2.847.300
> Break-even: mes 14

**Bien:**
> **Inversión inicial:** RD$2,1M – 2,8M – 3,6M · *estimado*
> Derivado de: costo por m² *(referencia sectorial, ICDV 2026-Q2)* × área
> confirmada *(usuario)*
>
> **Break-even:** mes 11 – 14 – 22 · *estimado*
> Sensible a: ticket promedio, tasa de ocupación

La segunda forma es más larga y menos satisfactoria de mirar. También es la
única de las dos que es cierta.
