# SODEJA — MVP User Flows

**Spec only.** Screen-state descriptions for the Phase 1 vertical slice. No
wireframes; this document defines *what state exists and what it must say*, not
visual design. UI copy is written in Spanish (DO) as it should appear;
surrounding commentary is in English.

Product-level conventions that apply to **every** screen below and are not
repeated per screen:

- **No bare numbers.** Every figure renders as a band (pesimista / base /
  optimista) with its provenance chip: `usuario` · `referencia sectorial` ·
  `estimado`.
- **Every screen is leaveable and resumable.** The project autosaves; a user
  interrupted at step 6 returns to step 6.
- **Errors state a cause and an action.** Never a bare spinner, never an
  unexplained empty state.
- **Dataset vintages are visible**, not buried in a tooltip.

---

## Primary flow — "Estudio de Ubicación Comercial"

The one complete, sellable path. Nine steps. A persistent progress rail on the
left shows all nine with completion state, so the user can always see how much
remains — this is a long flow and abandonment is the main UX risk.

### Step 0 — Entrada

**Screen: Login / registro**

| State | Behaviour |
|---|---|
| First visit | Email or Google sign-in. Below the form: the current ToS and privacy notice, each linked, with a single explicit acceptance checkbox. Acceptance is recorded against the document *version*. |
| Consent prompt | Separate, granular toggles (Ley 172-13): precise location, analytics, marketing. **Precise location is optional and the app must remain fully usable without it** — the user places a pin manually instead. |
| Returning user with new ToS version | Re-acceptance interstitial naming what changed. Not dismissible, but the user may still read their existing projects. |

### Step 1 — Selección de ubicación

**Screen: Mapa**

Map centred on Santo Domingo by default. Search box for an address; a "usar mi
ubicación" control appears only if location consent was granted.

**No satellite basemap in the MVP** (paid tile providers are not provisioned).
The user orients on OSM streets plus the ingested footprint layer rendered as
vector outlines. This is workable — the footprints are the selectable target
either way — but it removes the visual confirmation of "yes, that is the
building I mean", so the Step 2 confirmation screen carries more weight than it
otherwise would. Worth watching in usability testing.

| State | Behaviour |
|---|---|
| Idle | Map with footprint layer visible at zoom ≥ 17. Helper text: "Toque el edificio o local que quiere evaluar." |
| Outside a launch area | Non-blocking banner: "Todavía no cubrimos esta zona. El análisis está disponible en Distrito Nacional, Santo Domingo y Santiago." Tapping is disabled; the map still pans so the user can see the covered areas. |
| Tap → one candidate | The footprint highlights. A bottom sheet shows approximate area, address if known, and the source + vintage of the outline. Primary action: "Confirmar este espacio". |
| Tap → multiple candidates | Overlapping footprints listed in the sheet, each selectable, each showing its own area. Common where datasets disagree. |
| Tap → no candidate | **Falls through to Secondary Flow A** (manual draw). Copy must distinguish absence of data from absence of a building: "No tenemos el contorno de este edificio. Dibújelo usted mismo." |
| Loading | Skeleton in the sheet; the map stays interactive. |
| Provider error | "No pudimos cargar el mapa. Reintentar." The rest of the project remains accessible. |

### Step 2 — Confirmación del espacio  *(hard gate)*

**Screen: Confirmar área**

The most important screen in the product. Nothing downstream may be computed
until it is passed, because an unconfirmed area propagates into a break-even
figure a user might borrow against.

- Large, editable area field pre-filled with the dataset suggestion.
- Beneath it, verbatim: *"Esta área es aproximada y proviene de imágenes
  satelitales. Puede tener un margen de error importante. Verifíquela o
  corríjala antes de continuar."*
- Optional inputs: number of floors, usable vs. total area.
- Primary action label is explicit — **"Confirmo esta área"**, not "Siguiente".

| State | Behaviour |
|---|---|
| Suggestion accepted unchanged | Recorded as `footprint_dataset` + confirmed. |
| User edits the number | Source flips to `user_entered`, provenance chip becomes `usuario`. The original suggestion is retained (not shown) as accuracy telemetry. |
| Area implausible for the type | Inline warning, e.g. "Un restaurante de 8 m² es inusual. ¿Es correcto?" — a warning, never a block. |
| Attempt to skip | The Continue control is disabled with a reason, not hidden. |

### Step 3 — Entorno del mercado *(Module 1)*

**Screen: Población y competencia**

Radius selector (default 500 m). Shows population estimate, competitor count by
category, and a confidence tier.

| State | Behaviour |
|---|---|
| Confidence `alta` / `media` | Figures shown normally with census year and POI vintage displayed. |
| Confidence `baja` | Figures shown with a prominent caveat: "Tenemos poca información de esta zona. Estos números pueden subestimar la competencia real." |
| Confidence `insuficiente` | Numbers **suppressed**, not shown greyed. Copy explains why and invites manual entry. Silently showing "2 competidores" from thin data is worse than showing nothing. |
| Always present | "Agregar un negocio que usted conoce" — manual competitor entry is a first-class action, because informal businesses appear in no dataset. |

### Step 4 — Tipo de negocio *(Module 5)*

**Screen: Seleccionar tipo**

Cards for the 4-6 launch types (restaurante, colmado, ferretería, salón,
minimarket). Selecting one pre-fills the entire assumption set from curated
benchmarks. A visible note: "Vamos a partir de valores de referencia del sector.
Usted podrá ajustarlos todos."

If a user's intended type is absent: "No encontramos su tipo de negocio" with a
capture field, which doubles as sector-demand research.

### Step 5 — Distribución y capacidad *(Modules 4 + 6)*

**Screen: Distribución preliminar**

Zone breakdown as proportional bars over the confirmed area (salón, cocina,
almacén, baños, circulación), each a range, each editable.

Persistent note: *"Estas proporciones provienen de estándares internacionales,
no dominicanos."* This is a known data gap and hiding it would be dishonest.

**Screen: Capacidad estimada**

Seats, staff, daily customers — all bands. Each ratio used is expandable to show
its value, source, and provenance. Editing a ratio recomputes immediately
(client-side `@sodeja/calc`, no round trip).

### Step 6 — Costos *(Modules 9 + 10)*

**Screen: Costo de habilitación**

Total as a wide band, broken down by zone. Labelled **indicativo**, with the
construction-index base date shown. Copy is explicit about the limitation:
"Estimado a partir de índices de construcción de vivienda, ajustado por tipo de
negocio. No sustituye una cotización."

**Screen: Costos operativos mensuales**

Line items: nómina, TSS, alquiler, servicios, insumos, otros. Payroll and TSS
carry citations to official figures; rent and utilities are curated ranges.
Utilities line explicitly mentions planta/inversor cost.

Rent is the item users most often know better than SODEJA does — it is
prominently editable, and the flow expects it to be edited.

### Step 7 — Proyección financiera *(Module 7)*

**Screen: Proyección**

The integration point.

| State | Behaviour |
|---|---|
| Prerequisites missing | Blocked with a checklist of exactly what is missing, each deep-linking back to its step. Never computed from silent defaults. |
| Computed | Monthly revenue/cost/cash chart with a shaded band, not a single line. Break-even shown as a **range of months**. |
| Break-even not reached | "No alcanza el punto de equilibrio en el horizonte proyectado." Never rendered as 0 or as a blank. |
| Always | A sensitivity list — "Lo que más mueve su resultado" — ranked. Mandatory display, not an optional panel. |

### Step 8 — Permisos *(Module 12)*

**Screen: Checklist de permisos**

Items grouped by agency, each with requirement level, source citation, and the
date the source was retrieved. Checkboxes are the **user's own** tracking.

Header text, non-dismissible: *"Esta lista no es exhaustiva. No confirma que su
negocio pueda operar. Verifique con cada institución."*

There is no state, badge, colour, or progress indicator implying the user is
cleared to open. A fully-ticked checklist looks the same as a partial one in
every respect except the checkmarks.

### Step 9 — Resumen y exportación *(Module 13)*

**Screen: Resumen del análisis**

Everything on one scrollable page: site, environment, capacity, costs,
projection, permits. Every figure retains its band and provenance chip.

Export action → **Secondary Flow C**.

---

## Secondary Flow A — Manual polygon draw (footprint missing)

Entered from Step 1 when a tap returns no candidate — expected to be common
outside dense urban cores, so this is a designed path, not an error handler.

1. **Prompt.** "No tenemos el contorno de este edificio. Puede dibujarlo o
   escribir el área directamente." Two clear options; neither is a dead end.
2. **Draw mode.** Tap to place vertices, drag to adjust, undo last point. Live
   area readout in m² updates as the polygon closes.
3. **Validation states.**
   - Fewer than 3 points: Confirm disabled, "Necesita al menos 3 puntos."
   - Self-intersecting polygon: vertices highlighted red, "El contorno se cruza."
   - Implausible area (< 5 m² or > 5,000 m²): warning, not a block.
4. **Alternative path — type the area.** For users who know the number and
   should not be forced to draw. Recorded as `user_entered`.
5. **Convergence.** Both paths land on Step 2 with `areaSource` set accordingly
   and provenance `usuario`. A drawn or typed area is *more* trusted than a
   dataset one, and the UI should not imply otherwise.

**Offline (Android):** drawing works against cached tiles; the confirmation
queues and syncs. The user is told: "Guardado. Se sincronizará cuando tenga
conexión."

---

## Secondary Flow B — Editing an assumption

Reachable from any figure in the flow and from a global "Supuestos" panel
listing every assumption in one place.

1. **Entry.** Tap any number, or open the panel. Each row shows: label, current
   band, unit, provenance chip, and source link where one exists.
2. **Edit.** Three inputs (pesimista / base / optimista). Entering only the base
   value keeps the existing relative spread rather than collapsing the band to a
   point — the product must not let a user accidentally destroy its own
   uncertainty modelling.
3. **Immediate feedback.** Provenance flips to `usuario`; a "modificado" marker
   appears; `@sodeja/calc` recomputes locally so dependent figures update without
   a round trip.
4. **Implausible values.** Inline warning naming the expected range and its
   source. Accepted regardless — the user may know their market better than the
   benchmark. This is instrumented: systematically overridden defaults are the
   signal that a curated benchmark is wrong.
5. **Restore.** Every overridden row offers "Restaurar valor de referencia",
   showing what it would revert to.
6. **Downstream staleness.** Results computed before the edit are marked
   "Desactualizado" with a "Recalcular" action. Stale numbers are never shown as
   current, and never silently recomputed either — the user sees that something
   changed.

---

## Secondary Flow C — Exporting the summary report

1. **Trigger.** "Exportar resumen" from Step 9.
2. **Pre-export gate.** A summary of what the document will and will not be:
   > "Este documento es un **resumen de análisis**, no un plan de negocio
   > auditado. Los números provienen de sus supuestos y de estimaciones del
   > sistema. No debe usarse como única base para una decisión de inversión o
   > financiamiento."

   Confirmation is explicit. Phase 1 offers only this tier; the bank-facing
   "Plan de Negocio" is visibly marked *Próximamente* rather than hidden, since
   it is a known demand signal worth measuring.
3. **Queued.** "Estamos generando su documento." The user may navigate away;
   the report appears in a list and notifies on completion. Rendering never
   blocks the UI.
4. **Ready.** Download via a short-lived signed URL. The list shows generation
   date, engine version, and rule-pack version — so a user holding two exports
   can tell which is which.
5. **Failed.** Named reason and a retry, plus a support path. A failed export
   after a long analysis is a high-frustration moment and deserves real copy.
6. **What the PDF must contain** (compliance, not formatting): non-dismissible
   disclaimer; assumptions appendix with every provenance tag; engine and
   rule-pack versions; generation date; ranges throughout; data-source
   attribution; watermark on this tier.

**Offline (Android):** export requires connectivity. The action is visible but
disabled with the reason stated — "Necesita conexión para generar el documento"
— never hidden, so the user knows the capability exists.
