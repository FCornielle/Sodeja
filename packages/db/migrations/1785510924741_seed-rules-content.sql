-- Up Migration
-- =====================================================================
-- SODEJA — B-10 seed content: jurisdictions, business types, and the
-- narrow set of parameter_value figures SODEJA_DATA_SOURCES.md marks
-- "VERIFIED exactly" (verification pass 2026-07-24/25).
--
-- Idempotent by design (safe to re-run): jurisdiction/business_type/
-- parameter_table use their existing UNIQUE(slug) constraints via
-- ON CONFLICT DO NOTHING; content.citation and content.parameter_value have
-- no unique constraint in specs/db/schema.sql (by design — see that file),
-- so those inserts use WHERE NOT EXISTS guards on their natural key instead.
--
-- Deliberately NOT seeded here, per docs/SODEJA_DATA_SOURCES.md and
-- SODEJA_RISKS.md T3 — each of these lacks a defensible citation today:
--   - RST tax threshold: CPI-indexed by statute, currently in dispute
--     between two candidate figures pending DGII's implementing regulation.
--   - TSS employer AFP %: Ley 87-01 primary text returned 403 on both
--     verification attempts ("still low-confidence — do not code it").
--   - Restaurant/gastronomic minimum wage (Res. CNS-04-2025): source is a
--     scanned, non-machine-readable image, not extractable exactly.
--   - Any MOPC/permit content (R-007 scope of application unread/unconfirmed).
-- These are a Phase-0 content-curation gap (risk F2), not something to paper
-- over with a guessed figure.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Jurisdictions: nacional + the two MVP launch metro areas
-- (SODEJA_ARCHITECTURE.md Master Plan; SODEJA_DATA_SOURCES.md).
-- ---------------------------------------------------------------------
INSERT INTO content.jurisdiction (slug, level, name, parent_id)
VALUES ('nacional', 'nacional', 'República Dominicana', NULL)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO content.jurisdiction (slug, level, name, parent_id)
SELECT 'distrito-nacional', 'provincia', 'Distrito Nacional', j.id
FROM content.jurisdiction j WHERE j.slug = 'nacional'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO content.jurisdiction (slug, level, name, parent_id)
SELECT 'santo-domingo', 'provincia', 'Santo Domingo', j.id
FROM content.jurisdiction j WHERE j.slug = 'nacional'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO content.jurisdiction (slug, level, name, parent_id)
SELECT 'santiago', 'provincia', 'Santiago', j.id
FROM content.jurisdiction j WHERE j.slug = 'nacional'
ON CONFLICT (slug) DO NOTHING;


-- ---------------------------------------------------------------------
-- Business types: catalog-only rows, no numbers attached (numbers live
-- entirely in parameter_value). MVP launch sectors.
-- ---------------------------------------------------------------------
INSERT INTO content.business_type (slug, name_es, is_active, display_order)
VALUES
  ('restaurante',  'Restaurante',  true, 1),
  ('colmado',      'Colmado',      true, 2),
  ('ferreteria',   'Ferretería',   true, 3),
  ('salon',        'Salón de belleza', true, 4),
  ('minimarket',   'Minimarket',   true, 5)
ON CONFLICT (slug) DO NOTHING;


-- ---------------------------------------------------------------------
-- Citations: one per source instrument backing the verified figures below.
-- No UNIQUE constraint exists on content.citation (specs/db/schema.sql), so
-- this guards on (source_name, document_title) as the natural key.
-- ---------------------------------------------------------------------
INSERT INTO content.citation (source_name, document_title, retrieved_on, is_verified, verification_note)
SELECT v.source_name, v.document_title, v.retrieved_on::date, true, v.note
FROM (VALUES
  (
    'Comité Nacional de Salarios (CNS)',
    'Resolución CNS-01-2025',
    '2026-07-25',
    'Salarios mínimos por tamaño de empresa (micro/pequeña/mediana/grande), vigencia 2026-02-01. ' ||
    'VERIFIED exactly per docs/SODEJA_DATA_SOURCES.md (pase de verificación 2026-07-24/25). ' ||
    'No cubre el salario mínimo gastronómico/restaurante (Res. CNS-04-2025, fuente PDF escaneada, ' ||
    'no extraíble con exactitud) — deliberadamente no sembrado.'
  ),
  (
    'Tesorería de la Seguridad Social (TSS)',
    'Ley 87-01 — Sistema Dominicano de Seguridad Social',
    '2026-07-25',
    'Topes TSS (Base/Riesgos/SFS/Pensiones) y aportes laborales SFS 3.04% / AFP 2.87%, vigencia ' ||
    '2026-02-01. VERIFIED exactly per docs/SODEJA_DATA_SOURCES.md. El aporte patronal AFP NO está ' ||
    'incluido aquí: texto primario de la Ley 87-01 devolvió error 403 en ambos intentos de ' ||
    'verificación ("still low-confidence — do not code it").'
  ),
  (
    'INFOTEP',
    'Ley 116-80 — Ley del Instituto Nacional de Formación Técnico Profesional',
    '2026-07-25',
    'Aporte patronal INFOTEP, 1% de la nómina bruta. Ausente por completo del modelo de costos ' ||
    'operativos hasta este pase de verificación; es obligatorio. Per docs/SODEJA_DATA_SOURCES.md.'
  )
) AS v(source_name, document_title, retrieved_on, note)
WHERE NOT EXISTS (
  SELECT 1 FROM content.citation c
  WHERE c.source_name = v.source_name AND c.document_title = v.document_title
);


-- ---------------------------------------------------------------------
-- Parameter tables: one slug per rate/ceiling/wage-floor. content.parameter_value
-- has no company-size column, so each wage tier and each TSS ceiling is its
-- own table rather than a shared one with an extra dimension.
-- ---------------------------------------------------------------------
INSERT INTO content.parameter_table (slug, name_es, unit, domain)
VALUES
  ('tss_ceiling_base',       'Tope TSS — Base',                              'DOP',     'labor'),
  ('tss_ceiling_riesgos',    'Tope TSS — Riesgos Laborales',                 'DOP',     'labor'),
  ('tss_ceiling_sfs',        'Tope TSS — Seguro Familiar de Salud (SFS)',    'DOP',     'labor'),
  ('tss_ceiling_pensiones',  'Tope TSS — Pensiones (AFP)',                   'DOP',     'labor'),
  ('tss_employee_sfs_rate',  'Aporte laboral SFS (empleado)',                'percent', 'labor'),
  ('tss_employee_afp_rate',  'Aporte laboral AFP (empleado)',                'percent', 'labor'),
  ('infotep_employer_rate',  'Aporte patronal INFOTEP (% nómina bruta)',     'percent', 'labor'),
  ('salario_minimo_micro',   'Salario mínimo — Microempresa (CNS-01-2025)',  'DOP',     'labor'),
  ('salario_minimo_pequena', 'Salario mínimo — Pequeña empresa (CNS-01-2025)', 'DOP',   'labor'),
  ('salario_minimo_mediana', 'Salario mínimo — Mediana empresa (CNS-01-2025)', 'DOP',   'labor'),
  ('salario_minimo_grande',  'Salario mínimo — Gran empresa (CNS-01-2025)',  'DOP',     'labor')
ON CONFLICT (slug) DO NOTHING;


-- ---------------------------------------------------------------------
-- Parameter values: nationally-applicable (jurisdiction 'nacional'),
-- business-type-agnostic (NULL — none of these figures vary by sector),
-- exact statutory amounts, so low = base = high on every row (itself
-- informative to the reader per specs/db/schema.sql's comment on that column).
-- No UNIQUE constraint exists on content.parameter_value, so this guards on
-- (parameter_table_id, jurisdiction_id, business_type_id IS NULL, valid_from).
-- ---------------------------------------------------------------------
INSERT INTO content.parameter_value
  (parameter_table_id, business_type_id, jurisdiction_id, value_low, value_base, value_high,
   currency, valid_from, citation_id, provenance)
SELECT pt.id, NULL, j.id, v.value, v.value, v.value, v.currency, v.valid_from::date, c.id,
       'referencia_sectorial'
FROM (VALUES
  ('tss_ceiling_base',       23223,    'DOP',  '2026-02-01', 'Tesorería de la Seguridad Social (TSS)', 'Ley 87-01 — Sistema Dominicano de Seguridad Social'),
  ('tss_ceiling_riesgos',    92892,    'DOP',  '2026-02-01', 'Tesorería de la Seguridad Social (TSS)', 'Ley 87-01 — Sistema Dominicano de Seguridad Social'),
  ('tss_ceiling_sfs',        232230,   'DOP',  '2026-02-01', 'Tesorería de la Seguridad Social (TSS)', 'Ley 87-01 — Sistema Dominicano de Seguridad Social'),
  ('tss_ceiling_pensiones',  464460,   'DOP',  '2026-02-01', 'Tesorería de la Seguridad Social (TSS)', 'Ley 87-01 — Sistema Dominicano de Seguridad Social'),
  ('tss_employee_sfs_rate',  3.04,     NULL,   '2026-02-01', 'Tesorería de la Seguridad Social (TSS)', 'Ley 87-01 — Sistema Dominicano de Seguridad Social'),
  ('tss_employee_afp_rate',  2.87,     NULL,   '2026-02-01', 'Tesorería de la Seguridad Social (TSS)', 'Ley 87-01 — Sistema Dominicano de Seguridad Social'),
  ('infotep_employer_rate',  1,        NULL,   '1980-01-01', 'INFOTEP', 'Ley 116-80 — Ley del Instituto Nacional de Formación Técnico Profesional'),
  ('salario_minimo_micro',    16993.20, 'DOP', '2026-02-01', 'Comité Nacional de Salarios (CNS)', 'Resolución CNS-01-2025'),
  ('salario_minimo_pequena',  18421.20, 'DOP', '2026-02-01', 'Comité Nacional de Salarios (CNS)', 'Resolución CNS-01-2025'),
  ('salario_minimo_mediana',  27489.60, 'DOP', '2026-02-01', 'Comité Nacional de Salarios (CNS)', 'Resolución CNS-01-2025'),
  ('salario_minimo_grande',   29988.00, 'DOP', '2026-02-01', 'Comité Nacional de Salarios (CNS)', 'Resolución CNS-01-2025')
) AS v(table_slug, value, currency, valid_from, cite_source, cite_doc)
JOIN content.parameter_table pt ON pt.slug = v.table_slug
JOIN content.jurisdiction j ON j.slug = 'nacional'
JOIN content.citation c ON c.source_name = v.cite_source AND c.document_title = v.cite_doc
WHERE NOT EXISTS (
  SELECT 1 FROM content.parameter_value pv
  WHERE pv.parameter_table_id = pt.id AND pv.jurisdiction_id = j.id
    AND pv.business_type_id IS NULL AND pv.valid_from = v.valid_from::date
);


-- Down Migration

DELETE FROM content.parameter_value pv
USING content.parameter_table pt
WHERE pv.parameter_table_id = pt.id
  AND pt.slug IN (
    'tss_ceiling_base', 'tss_ceiling_riesgos', 'tss_ceiling_sfs', 'tss_ceiling_pensiones',
    'tss_employee_sfs_rate', 'tss_employee_afp_rate', 'infotep_employer_rate',
    'salario_minimo_micro', 'salario_minimo_pequena', 'salario_minimo_mediana', 'salario_minimo_grande'
  );

DELETE FROM content.parameter_table
WHERE slug IN (
  'tss_ceiling_base', 'tss_ceiling_riesgos', 'tss_ceiling_sfs', 'tss_ceiling_pensiones',
  'tss_employee_sfs_rate', 'tss_employee_afp_rate', 'infotep_employer_rate',
  'salario_minimo_micro', 'salario_minimo_pequena', 'salario_minimo_mediana', 'salario_minimo_grande'
);

DELETE FROM content.citation
WHERE (source_name, document_title) IN (
  ('Comité Nacional de Salarios (CNS)', 'Resolución CNS-01-2025'),
  ('Tesorería de la Seguridad Social (TSS)', 'Ley 87-01 — Sistema Dominicano de Seguridad Social'),
  ('INFOTEP', 'Ley 116-80 — Ley del Instituto Nacional de Formación Técnico Profesional')
);

DELETE FROM content.business_type
WHERE slug IN ('restaurante', 'colmado', 'ferreteria', 'salon', 'minimarket');

DELETE FROM content.jurisdiction WHERE slug IN ('distrito-nacional', 'santo-domingo', 'santiago');
DELETE FROM content.jurisdiction WHERE slug = 'nacional';
