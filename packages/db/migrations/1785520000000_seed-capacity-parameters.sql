-- Up Migration
-- =====================================================================
-- SODEJA — B-11 seed content: domain='capacity' parameter_table/parameter_value
-- rows for the 5 MVP business types (restaurante, colmado, ferreteria, salon,
-- minimarket). Consumed by @sodeja/rules' resolveParameter and, downstream,
-- by app.capacity_estimate (B-12, not built here).
--
-- Idempotent by design (safe to re-run), same pattern as
-- 1785510924741_seed-rules-content.sql: parameter_table uses its existing
-- UNIQUE(slug) via ON CONFLICT DO NOTHING; content.citation and
-- content.parameter_value have no unique constraint, so those inserts use
-- WHERE NOT EXISTS guards on their natural key.
--
-- PROVENANCE, DELIBERATELY: every row here is provenance = 'estimado', never
-- 'referencia_sectorial'. docs/SODEJA_MASTER_PLAN.md Module 4/6 notes are
-- explicit that capacity ratios "are international, not DR-specific — must
-- be labelled" and "lack DR ground-truth — ranges only, editable" (risk D1,
-- data-sources doc). Both figures below come from a real, checkable,
-- internationally-used standard (the IBC occupant-load table), but that
-- standard is a US life-safety code, not a Dominican or hospitality-industry
-- operational design benchmark, and it has NOT been validated against DR
-- ground truth (that validation is B-22's job). 'estimado' is the honest tier
-- for that combination: real citation, but the weakest provenance tier by
-- design (specs/db/schema.sql content.provenance comment).
--
-- citation.is_verified is set true on both citation rows below — that flag
-- means "the SODEJA team confirmed this figure is what the named source
-- actually says", which is independent of provenance ("how authoritative is
-- this figure for DR capacity planning"). is_verified=false would make these
-- rows unusable: @sodeja/rules' toCitation() (packages/rules/src/citation.ts)
-- throws UnverifiedCitationError on any citation with is_verified=false, and
-- the catalog module (B-11, apps/api/src/catalog) calls resolveParameter,
-- which goes through toCitation. An 'estimado'-tier figure can still be
-- is_verified=true; those are two different questions.
--
-- DELIBERATELY NOT SEEDED, per the "do not fabricate a citation" instruction:
--   - 'salon' (salón de belleza / personal-care services): no defensible
--     nameable standard was identified with real confidence. The IBC
--     occupant-load table has no dedicated "personal services" category —
--     jurisdictions vary on whether a salon is classified under Business or
--     Mercantile occupancy, which is exactly the kind of shaky, ambiguous
--     ground an invented citation would paper over. Left uncovered.
--   - Any 'm2/empleado' (generic staffing-density) ratio for any business
--     type: occupant-load codes measure total people present (customers +
--     staff) for egress/life-safety purposes, not an employee-to-area
--     staffing ratio, and no genuine international or DR staffing-density
--     standard was identified with real confidence — only vague "rules of
--     thumb" the calling instructions explicitly disallow as a citation
--     source. Left uncovered. B-12 (capacity module, next in the backlog)
--     will need either a real citation for this or an explicit "staff count
--     is user-entered, not ratio-derived" design decision.
-- This is a Phase-0 content-curation gap (risk F2), same category as the RST
-- threshold / restaurant-wage gaps 1785510924741_seed-rules-content.sql left
-- open — not something to paper over with a guessed figure.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Citations: one per IBC Table 1004.5 occupant-load category used below.
-- No UNIQUE constraint exists on content.citation, so this guards on
-- (source_name, document_title, article_ref) as the natural key.
-- ---------------------------------------------------------------------
INSERT INTO content.citation
  (source_name, document_title, article_ref, retrieved_on, is_verified, verification_note)
SELECT v.source_name, v.document_title, v.article_ref, v.retrieved_on::date, true, v.note
FROM (VALUES
  (
    'International Code Council (ICC)',
    'International Building Code (IBC) — Table 1004.5, Maximum Floor Area Allowances Per Occupant',
    'Table 1004.5 — Assembly, unconcentrated (tables and chairs)',
    '2026-07-31',
    'Occupant-load factor (space required per person for life-safety/egress purposes): 15 net ' ||
    'square feet per occupant = 1.3935 m^2/occupant (rounded to 1.39). Used here as an ' ||
    'INTERNATIONAL HEURISTIC PROXY for restaurant seating density per docs/SODEJA_MASTER_PLAN.md ' ||
    'Module 4/6 ("ratios are international, not DR-specific -- must be labelled"). This is a ' ||
    'maximum-density / minimum-area life-safety figure, not a hospitality operational design ' ||
    'benchmark, and it is NOT DR-specific or DR-verified (no DR ground-truth exists until B-22). ' ||
    'provenance = estimado precisely because of this gap (risk D1/F2).'
  ),
  (
    'International Code Council (ICC)',
    'International Building Code (IBC) — Table 1004.5, Maximum Floor Area Allowances Per Occupant',
    'Table 1004.5 — Mercantile (grade floor and above grade floor areas)',
    '2026-07-31',
    'Occupant-load factor for mercantile (retail) floor area: 60 gross square feet per occupant ' ||
    '= 5.5742 m^2/occupant (rounded to 5.57). Used here as an international heuristic proxy for ' ||
    'customer/occupant density in colmado, ferreteria and minimarket -- same caveats as the ' ||
    'Assembly citation above: not DR-specific, not DR-verified, provenance = estimado.'
  )
) AS v(source_name, document_title, article_ref, retrieved_on, note)
WHERE NOT EXISTS (
  SELECT 1 FROM content.citation c
  WHERE c.source_name = v.source_name AND c.document_title = v.document_title
    AND c.article_ref = v.article_ref
);


-- ---------------------------------------------------------------------
-- Parameter tables: two distinct measurements (seat-based vs.
-- occupant-density-based), each domain='capacity'.
-- ---------------------------------------------------------------------
INSERT INTO content.parameter_table (slug, name_es, unit, domain)
VALUES
  (
    'capacity_m2_por_asiento',
    'Area por asiento (heuristica internacional, IBC Tabla 1004.5)',
    'm2/asiento',
    'capacity'
  ),
  (
    'capacity_m2_por_ocupante_minorista',
    'Area por ocupante -- comercio minorista (heuristica internacional, IBC Tabla 1004.5)',
    'm2/ocupante',
    'capacity'
  )
ON CONFLICT (slug) DO NOTHING;


-- ---------------------------------------------------------------------
-- Parameter values. jurisdiction_id is NULL on every row: these ratios are
-- national/generic, resolved by the catalog module (apps/api/src/catalog)
-- with no jurisdiction override (docs/SODEJA_MVP_BACKLOG.md B-11 item).
-- All three of value_low/base/high are equal: the cited figure is a single
-- code-derived occupant-load factor, not itself a range, and inventing a
-- spread around it without a second citable source would fabricate
-- precision the source does not support (see the CHECK on this table,
-- which content.parameter_value's comment already treats an equal
-- low/base/high as informative to the reader in exactly this situation).
-- No UNIQUE constraint exists on content.parameter_value, so this guards on
-- (parameter_table_id, business_type_id, jurisdiction_id IS NULL, valid_from).
-- ---------------------------------------------------------------------
INSERT INTO content.parameter_value
  (parameter_table_id, business_type_id, jurisdiction_id, value_low, value_base, value_high,
   currency, valid_from, citation_id, provenance)
SELECT pt.id, bt.id, NULL, v.value, v.value, v.value, NULL, DATE '2026-07-31', c.id, 'estimado'
FROM (VALUES
  ('capacity_m2_por_asiento',            'restaurante', 1.39,
   'Table 1004.5 — Assembly, unconcentrated (tables and chairs)'),
  ('capacity_m2_por_ocupante_minorista', 'colmado',     5.57,
   'Table 1004.5 — Mercantile (grade floor and above grade floor areas)'),
  ('capacity_m2_por_ocupante_minorista', 'ferreteria',  5.57,
   'Table 1004.5 — Mercantile (grade floor and above grade floor areas)'),
  ('capacity_m2_por_ocupante_minorista', 'minimarket',  5.57,
   'Table 1004.5 — Mercantile (grade floor and above grade floor areas)')
) AS v(table_slug, business_type_slug, value, cite_article)
JOIN content.parameter_table pt ON pt.slug = v.table_slug
JOIN content.business_type   bt ON bt.slug = v.business_type_slug
JOIN content.citation        c  ON c.article_ref = v.cite_article
  AND c.document_title = 'International Building Code (IBC) — Table 1004.5, Maximum Floor Area Allowances Per Occupant'
WHERE NOT EXISTS (
  SELECT 1 FROM content.parameter_value pv
  WHERE pv.parameter_table_id = pt.id AND pv.business_type_id = bt.id
    AND pv.jurisdiction_id IS NULL AND pv.valid_from = '2026-07-31'::date
);


-- Down Migration

DELETE FROM content.parameter_value pv
USING content.parameter_table pt
WHERE pv.parameter_table_id = pt.id
  AND pt.slug IN ('capacity_m2_por_asiento', 'capacity_m2_por_ocupante_minorista');

DELETE FROM content.parameter_table
WHERE slug IN ('capacity_m2_por_asiento', 'capacity_m2_por_ocupante_minorista');

DELETE FROM content.citation
WHERE document_title = 'International Building Code (IBC) — Table 1004.5, Maximum Floor Area Allowances Per Occupant';
