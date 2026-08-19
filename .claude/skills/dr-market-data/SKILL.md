---
name: dr-market-data
description: Registro de fuentes de datos de República Dominicana para Esodeja — nómina (salario mínimo, TSS, INFOTEP), permisos municipales DN y Santiago, población censal, geometría administrativa, costos de construcción. Incluye el formato de cita obligatorio, los niveles de confianza y los conflictos abiertos conocidos. Carga esta skill antes de introducir, portar o consumir cualquier cifra dominicana.
---

# Datos de República Dominicana — registro de fuentes

Ninguna cifra dominicana entra al código sin cita, fecha de vigencia y nivel
de confianza. Este fichero es el registro; `esodeja-dr-research` es su dueño.

## 1. Jerarquía de fuentes

1. **Texto legal publicado** — ley, decreto, resolución. Lo mejor.
2. **Publicación oficial del organismo competente** — DGII, TSS, Ministerio de
   Trabajo, ONE, MICM.
3. **Publicación de gremio con metodología declarada** — ACOPROVI y similares.
4. **Prensa, blogs, agregadores** — **no son fuente.** Sirven como pista para
   encontrar la fuente real, nunca como respaldo de una cifra.

Si solo hay nivel 4, la respuesta correcta es **"no verificado"**, no una
cifra con reservas.

## 2. Formato de cita obligatorio

Toda cifra viaja con cuatro campos:

| Campo | Ejemplo |
|---|---|
| `value` | `0.01` |
| `citation` | `INFOTEP — 1% de la nómina bruta mensual` |
| `effectiveFrom` | `2026-01-01` |
| `confidence` | `verificado` / `parcial` / `no verificado` |

Una cifra sin los cuatro no está lista.

## 3. Nómina — el área más verificable, y por tanto la menos perdonable

| Concepto | Estado | Trampa |
|---|---|---|
| **INFOTEP** | 1% de nómina bruta | **Se omitió por completo** en el diseño inicial del proyecto anterior. No lo vuelvas a olvidar |
| **TSS** | Patas verificadas exactamente | Confirmar vigencia; la estructura del cálculo portado es correcta |
| **Salario mínimo** | Por tamaño de empresa | El tamaño es **determinación legal por doble criterio** — headcount **y** ventas brutas, Ley 488-08 / MICM Res. 79-2025. **No es un input del usuario**: se deriva |
| **Restaurantes** | Tabla salarial propia | Res. CNS-04-2025, **+25%** sobre el mínimo general. Procede de un documento **escaneado**, no legible por máquina — reverificar antes de confiar |

Aplicar el mínimo general a un restaurante es un error de ~25% en la mayor
línea del opex. Es el tipo de error que invalida un estudio entero.

## 4. Permisos — DN y Santiago

| Punto | Estado |
|---|---|
| **Uso de suelo** | **Ley 368-22, Art. 24 Párrafo I.** Ver §7: esta cita se corrigió tres veces |
| Cobertura | Solo Distrito Nacional y Santiago, más permisos nacionales |
| Encuadre | **Checklist no exhaustivo.** No existe afordancia de "cumple" — el producto no certifica cumplimiento |
| `formalizate.gob.do` | Cubre **solo formación de empresa**. No cubre uso de suelo, salud, bomberos ni ambiental. El hueco que este módulo llena es real |

Contenido portado desde
`../First Agentic Workflow/packages/db/migrations/1785560000000_seed-permits-content.sql`,
cuya cabecera registra qué se verificó y qué se dejó deliberadamente fuera.
**Léela antes de traducir el seed.**

## 5. Población y geometría

| Fuente | Estado | Advertencia |
|---|---|---|
| **Censo ONE 2022** | Verificado como fuente | **20,6% de omisión de hogares — la peor en 20 años**, sesgada hacia Santiago y Santo Domingo. La advertencia **viaja con el dato** y se muestra junto al número en la UI |
| **OCHA COD-AB** | Sustituto en uso | Geometría administrativa |
| **IDE-RD `RD_SECCIONES`** | **Inservible — publica cero capas.** Verificado | Por eso se usa OCHA, que es **más grueso**: nivel distrito-municipal, no sección ni barrio |

Consecuencia de producto: la resolución geográfica de la población es más
gruesa de lo ideal. Cualquier índice de demanda construido sobre ella hereda
esa imprecisión y debe declararla.

**El censo ONE 2022 no tiene API.** La extracción es manual vía REDATAM. Por
eso los datos entran como fichero estático commiteado, no como job ETL.

## 6. Costos de construcción y fit-out

**No existe una cifra oficial de RD$ por m² para fit-out comercial.** Esto es
un hallazgo verificado, no una laguna de búsqueda:

- ACOPROVI / ONE **ICDV no publican ninguna cifra de pesos por m².**
- Las cifras de RD$30-45k/m² que circulan **están mal atribuidas**: vienen de
  blogs inmobiliarios, no de esas instituciones.
- El ICDV cubre **solo costos directos de construcción de vivienda** en DN y
  provincia Santo Domingo. Sirve **únicamente como factor de escalación
  inflacionaria**, no como costo base.

Consecuencia: el dataset propio de costos es inevitable y está en la ruta
crítica. Cualquier cifra de fit-out que no venga de curación propia con
respaldo, se marca `no verificado`.

## 7. Conflictos abiertos y correcciones históricas

Se documentan, no se resuelven en silencio. Cuando dos fuentes discrepan, van
ambas al registro con la discrepancia explícita.

### La cita de uso de suelo, corregida tres veces

1. Se citó **Decreto 284-91**.
2. Se "corrigió" a **MOPC R-007** — que resultó ser el *Reglamento para
   Proyectar sin Barreras Arquitectónicas*, sobre **accesibilidad**, sin
   ninguna relación con uso de suelo. La corrección era a su vez incorrecta.
3. La respuesta buena es **Ley 368-22, Art. 24 Párrafo I**.

Es el mejor argumento a favor de la regla de fuente primaria: una cadena de
correcciones plausibles llevó dos veces al sitio equivocado.

### Régimen fiscal

Los topes del RST son **mucho más altos de lo asumido**: la mayoría del
público objetivo de Esodeja cae en el régimen simplificado, no en el
ordinario. e-CF (facturación electrónica) es **obligatorio para micro y
pequeñas empresas desde 2026-05-15**.

### Ley 633 y consultoría contable

La justificación de que la ley reserva la consultoría contable a CPAs
habilitados **no resistió la verificación**: solo actos estrechos como
auditorías y firma de estados están reservados. El encuadre de "directorio de
información, no asesoría" se mantiene, pero por **razones de responsabilidad**
— una cifra fiscal equivocada le cuesta dinero al usuario directamente — no
por reserva legal de actividad.

## 8. Lo que no se promete

**No hay datos de tráfico peatonal para República Dominicana a ningún precio
practicable.** Google Popular Times no tiene API pública y raspar viola los
términos. No es una laguna temporal: es una restricción permanente.

Lo más cercano que Esodeja ofrece es isócrona + población alcanzable,
etiquetado explícitamente como **proxy**, nunca como medición de tráfico.

## 9. Aviso

Las observaciones legales y fiscales de este registro son planificación de
riesgo, **no asesoría legal ni contable**. Cualquier conclusión con
consecuencia legal o fiscal requiere revisión de un profesional dominicano
habilitado. El producto es una herramienta de análisis, no un dictamen.
