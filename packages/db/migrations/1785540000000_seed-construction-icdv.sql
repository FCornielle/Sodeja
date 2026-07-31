-- Up Migration
-- =====================================================================
-- SODEJA — B-14 seed content: the ICDV construction-cost-index escalation
-- factor (domain='construction'), the ONE real, citable DR construction
-- figure per docs/SODEJA_DATA_SOURCES.md table (a):
--
--   "~~ACOPROVI/ONE ICDV -> RD$35,000/m2~~ ... PARTIALLY CONTRADICTED. Index
--   itself verified (236.17 pts, Dec 2025, +3.72% for 2025) but ICDV
--   publishes NO peso-per-m2 figure at all -- the RD$30-45k/m2 figures came
--   from real-estate blogs, not ACOPROVI. Also: direct costs only (excludes
--   land/design/permits/financing/profit), 4 housing typologies, DN+SD
--   province only. Usable as an escalation factor, not a cost basis."
--
-- Deliberately NOT seeded here: a base construction/fit-out cost per m2.
-- docs/SODEJA_DATA_SOURCES.md table (c) marks this "Genuinely unavailable" --
-- "the team's own curated cost basis is now unavoidable". app.fitout_estimate
-- takes that base cost as a REQUIRED user input on every request
-- (FitoutEstimateRequestSchema, @sodeja/schemas) rather than a seeded
-- default -- there is nothing defensible to seed.
--
-- Idempotent by design, same pattern as the other B-10/B-11 seed migrations:
-- content.parameter_table uses its UNIQUE(slug) via ON CONFLICT DO NOTHING;
-- content.citation and content.parameter_value have no unique constraint, so
-- those inserts use WHERE NOT EXISTS guards on their natural key.
-- =====================================================================


INSERT INTO content.citation
  (source_name, document_title, retrieved_on, is_verified, verification_note)
SELECT v.source_name, v.document_title, v.retrieved_on::date, true, v.note
FROM (VALUES
  (
    'ACOPROVI / ONE',
    'Índice de Costos Directos de la Construcción de Vivienda (ICDV)',
    '2026-07-25',
    'Índice verificado: 236.17 puntos, diciembre 2025, variación +3.72% en 2025. ' ||
    'VERIFICADO per docs/SODEJA_DATA_SOURCES.md (pase de verificación 2026-07-24/25) -- pero el ICDV ' ||
    'NO publica ninguna cifra en RD$/m2; las cifras de RD$30-45k/m2 citadas en blogs inmobiliarios NO ' ||
    'provienen de ACOPROVI/ONE y no fueron usadas aquí. El índice cubre solo costos directos (excluye ' ||
    'terreno, diseño, permisos, financiamiento, utilidad), 4 tipologías de vivienda, y solo Distrito ' ||
    'Nacional + Santo Domingo. Usable UNICAMENTE como factor de escalación/inflación sobre un costo ' ||
    'base suministrado por el usuario -- nunca como base de costo por si mismo (risk D7).'
  )
) AS v(source_name, document_title, retrieved_on, note)
WHERE NOT EXISTS (
  SELECT 1 FROM content.citation c
  WHERE c.source_name = v.source_name AND c.document_title = v.document_title
);


INSERT INTO content.parameter_table (slug, name_es, unit, domain)
VALUES (
  'icdv_escalacion_anual',
  'ICDV -- variación anual (factor de escalación de costos de construcción)',
  'percent',
  'construction'
)
ON CONFLICT (slug) DO NOTHING;


-- jurisdiction_id NULL (applies with no jurisdiction override), same choice
-- B-11's capacity ratios made: the underlying source is narrower than
-- national (DN+SD only, per the citation note above), but there is no
-- combined "DN+SD" jurisdiction row to attach it to more precisely, and
-- attaching it to only one of the two would misstate the source's actual
-- scope in the other direction. The citation note carries the honest caveat.
INSERT INTO content.parameter_value
  (parameter_table_id, business_type_id, jurisdiction_id, value_low, value_base, value_high,
   currency, valid_from, citation_id, provenance)
SELECT pt.id, NULL, NULL, 3.72, 3.72, 3.72, NULL, DATE '2025-12-01', c.id, 'referencia_sectorial'
FROM content.parameter_table pt, content.citation c
WHERE pt.slug = 'icdv_escalacion_anual'
  AND c.source_name = 'ACOPROVI / ONE'
  AND c.document_title = 'Índice de Costos Directos de la Construcción de Vivienda (ICDV)'
  AND NOT EXISTS (
    SELECT 1 FROM content.parameter_value pv
    WHERE pv.parameter_table_id = pt.id AND pv.jurisdiction_id IS NULL
      AND pv.business_type_id IS NULL AND pv.valid_from = DATE '2025-12-01'
  );


-- Down Migration

DELETE FROM content.parameter_value pv
USING content.parameter_table pt
WHERE pv.parameter_table_id = pt.id AND pt.slug = 'icdv_escalacion_anual';

DELETE FROM content.parameter_table WHERE slug = 'icdv_escalacion_anual';

DELETE FROM content.citation
WHERE source_name = 'ACOPROVI / ONE'
  AND document_title = 'Índice de Costos Directos de la Construcción de Vivienda (ICDV)';
