-- Up Migration
-- =====================================================================
-- SODEJA — B-13 seed content: domain='layout' parameter_table/parameter_value
-- rows. First migration to use the 'layout' domain (it has been valid in
-- content.parameter_table's CHECK since 1785113194367_initial-schema.sql but
-- was until now unused).
--
-- Idempotent by design (safe to re-run), same pattern as
-- 1785520000000_seed-capacity-parameters.sql: parameter_table uses its
-- existing UNIQUE(slug) via ON CONFLICT DO NOTHING; content.citation and
-- content.parameter_value have no unique constraint, so those inserts use
-- WHERE NOT EXISTS guards on their natural key.
--
-- ---------------------------------------------------------------------
-- WHAT B-13 ASKED FOR vs. WHAT IS ACTUALLY CITABLE — READ THIS FIRST
-- ---------------------------------------------------------------------
-- B-13's backlog title is "layout templates from typology ratios", and the
-- schema already has the table those ratios belong in:
-- content.layout_template (zone_slug + share_of_area_low/base/high).
--
-- THIS MIGRATION SEEDS NO content.layout_template ROWS. Not one, for any
-- business type. That is deliberate and it is the central finding of this
-- work item:
--
--   An occupant-load factor is a DENSITY WITHIN a zone (people per m2 of
--   that zone). A layout_template share_of_area is a PROPORTION BETWEEN
--   zones (what fraction of the premises that zone occupies). The second
--   cannot be derived from the first. IBC Table 1004.5 tells you that a
--   sales floor is designed for 1 occupant per 5.57 m2 and a stockroom for
--   1 occupant per 27.87 m2; it says exactly nothing about how much of a
--   given store is sales floor and how much is stockroom. Producing a
--   "70/30 sales-to-storage split" from those two numbers would require an
--   assumption found nowhere in the code — it would be a fabricated figure
--   wearing a real citation's clothes, which is the specific failure mode
--   1785520000000_seed-capacity-parameters.sql's header forbids.
--
-- A targeted search for any named standard, building code, or planning
-- reference that publishes sales-floor-to-storage (or dining-to-kitchen,
-- or salon station/retail/waiting) AREA PROPORTIONS found none. Every
-- circulating figure of that shape traces to trade blogs, franchise
-- marketing pages, or space-planning vendor calculators — not a standards
-- body. Same verdict, same reason, as B-11's refusal to seed salon capacity
-- or a generic staffing-density ratio.
--
-- So content.layout_template stays empty until either (a) a real published
-- architectural/planning reference is obtained and verified, or (b) the
-- product decision is made that zone shares are USER-ENTERED (provenance
-- 'usuario') with these occupant-load factors used only to sanity-check the
-- user's split, not to propose one. (b) is the honest MVP path and needs a
-- product-owner decision, not a guess from this layer.
--
-- ---------------------------------------------------------------------
-- WHAT IS SEEDED
-- ---------------------------------------------------------------------
-- Two genuinely-cited PER-ZONE occupant-load factors, both literal rows of
-- IBC Table 1004.5 (not derived, not interpolated):
--
--   * 'Storage, stock, shipping areas' = 300 gross ft2/occupant
--       -> 300 x 0.09290304 = 27.870912 m2  -> 27.87
--       -> almacen/trastienda zone of colmado, minimarket, ferreteria
--   * 'Kitchens, commercial' = 200 gross ft2/occupant
--       -> 200 x 0.09290304 = 18.580608 m2  -> 18.58
--       -> cocina zone of restaurante
--
-- The counterpart figures for the customer-facing zones already exist and
-- are NOT duplicated here: 1785520000000_seed-capacity-parameters.sql seeds
-- 'Mercantile' (60 gross ft2 = 5.57 m2/ocupante) as
-- capacity_m2_por_ocupante_minorista for colmado/ferreteria/minimarket, and
-- 'Assembly, unconcentrated' (15 net ft2 = 1.39 m2/asiento) as
-- capacity_m2_por_asiento for restaurante. Re-seeding the same code figures
-- under a second slug would create two rows that can silently drift apart.
-- A layout consumer resolves both slugs; parameter resolution is by slug,
-- not by domain (packages/rules/src/parameters.ts), so this costs nothing.
--
-- ---------------------------------------------------------------------
-- IBC EDITION — a correction worth recording
-- ---------------------------------------------------------------------
-- The figures above were verified 2026-08-16 against a jurisdiction-adopted
-- 2021 IBC text of Table 1004.5, not taken on trust. In doing so, one
-- commonly-repeated claim was found to be OUT OF DATE: the "Mercantile: 30
-- gross for basement and grade-floor areas, 60 gross for other floors"
-- split does NOT appear in Table 1004.5. That split is from IBC 2015 and
-- earlier, where the table was numbered 1004.1.2. From the 2018 edition on
-- — the editions where the table is numbered 1004.5 — Mercantile is a
-- SINGLE row at 60 gross. This project cites Table 1004.5, so 60 gross is
-- the correct and only mercantile figure, which is what B-11 already seeded.
-- Do not "fix" that row to 30 on the strength of a secondary source.
--
-- ---------------------------------------------------------------------
-- PROVENANCE / is_verified
-- ---------------------------------------------------------------------
-- provenance = 'estimado' on every row, for exactly the reasons spelled out
-- at length in 1785520000000_seed-capacity-parameters.sql's header: the IBC
-- is a real, checkable, internationally-used standard, but it is a US
-- life-safety code, not a DR-specific or operational layout-design
-- benchmark, and it has no DR ground-truth validation until B-22.
-- is_verified = true on both citations — that flag means "the SODEJA team
-- confirmed the named source says this", which is a different question from
-- provenance, and is_verified = false would make the rows unusable
-- (packages/rules/src/citation.ts toCitation() throws on unverified rows).
--
-- ---------------------------------------------------------------------
-- DELIBERATELY NOT SEEDED
-- ---------------------------------------------------------------------
--   - content.layout_template rows of any kind, for any business type: no
--     citable source for zone AREA SHARES exists (see above). This is the
--     bulk of B-13 as originally scoped.
--   - 'salon': IBC Table 1004.5 has no personal-care-services category, and
--     jurisdictions disagree on whether a salon is Business or Mercantile
--     occupancy — the same ambiguity that made B-11 leave salon capacity
--     uncovered. Seeding 'Business areas' (150 gross) for it would be
--     choosing one side of a live classification dispute and presenting the
--     result as cited fact. Salon has NO layout coverage at all.
--   - A restaurante dining-to-kitchen area split: 'Assembly, unconcentrated'
--     and 'Kitchens, commercial' are both real Table 1004.5 rows, but they
--     are densities, not proportions (see above). The kitchen factor is
--     seeded on its own terms; no split is derived from it.
--   - A ferreteria/colmado/minimarket sales-to-storage area split: same.
--   - Circulation/aisle minimum widths: a DR-specific figure (MOPC
--     reglamento R-021, accessibility) would be a strictly better citation
--     than any US code here, but portalweb.mopc.gob.do was unreachable on
--     2026-08-16 and nothing gets cited from this project that has not been
--     read. Worth retrying — it is the most promising unexplored source for
--     DR-specific layout content.
-- This is a Phase-0 content-curation gap (risk F2), same category as the
-- gaps 1785510924741_seed-rules-content.sql and the capacity migration left
-- open — not something to paper over with a guessed figure.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Citations: one per IBC Table 1004.5 occupant-load category used below.
-- source_name/document_title deliberately match the rows B-11 inserted, so
-- all Table 1004.5 citations group under one document. No UNIQUE constraint
-- exists on content.citation, so this guards on
-- (source_name, document_title, article_ref) as the natural key.
-- ---------------------------------------------------------------------
INSERT INTO content.citation
  (source_name, document_title, article_ref, retrieved_on, is_verified, verification_note)
SELECT v.source_name, v.document_title, v.article_ref, v.retrieved_on::date, true, v.note
FROM (VALUES
  (
    'International Code Council (ICC)',
    'International Building Code (IBC) — Table 1004.5, Maximum Floor Area Allowances Per Occupant',
    'Table 1004.5 — Storage, stock, shipping areas',
    '2026-08-16',
    'Occupant-load factor for stock/storage floor area accessory to a retail premises: 300 gross ' ||
    'square feet per occupant = 27.870912 m^2/occupant (rounded to 27.87). Verified 2026-08-16 ' ||
    'against a jurisdiction-adopted 2021 IBC text of Table 1004.5. This is a life-safety egress ' ||
    'density for the STOCKROOM ZONE ONLY -- it does NOT state what share of a store is stockroom, ' ||
    'and must not be combined with the Mercantile factor to derive an area split (see this ' ||
    'migration''s header). Not DR-specific, not DR-verified (no DR ground truth until B-22); ' ||
    'provenance = estimado for that reason (risk D1/F2).'
  ),
  (
    'International Code Council (ICC)',
    'International Building Code (IBC) — Table 1004.5, Maximum Floor Area Allowances Per Occupant',
    'Table 1004.5 — Kitchens, commercial',
    '2026-08-16',
    'Occupant-load factor for a commercial kitchen: 200 gross square feet per occupant = ' ||
    '18.580608 m^2/occupant (rounded to 18.58). Verified 2026-08-16 against a ' ||
    'jurisdiction-adopted 2021 IBC text of Table 1004.5. Density for the KITCHEN ZONE ONLY -- it ' ||
    'does NOT state a dining-to-kitchen area proportion, and no dining:kitchen split is derived ' ||
    'from it anywhere in this migration. Same caveats as the Storage citation above: not ' ||
    'DR-specific, not DR-verified, provenance = estimado.'
  )
) AS v(source_name, document_title, article_ref, retrieved_on, note)
WHERE NOT EXISTS (
  SELECT 1 FROM content.citation c
  WHERE c.source_name = v.source_name AND c.document_title = v.document_title
    AND c.article_ref = v.article_ref
);


-- ---------------------------------------------------------------------
-- Parameter tables: per-zone occupant-load factors, domain='layout'.
-- ---------------------------------------------------------------------
INSERT INTO content.parameter_table (slug, name_es, unit, domain)
VALUES
  (
    'layout_m2_por_ocupante_almacen',
    'Area por ocupante -- zona de almacen/trastienda (heuristica internacional, IBC Tabla 1004.5)',
    'm2/ocupante',
    'layout'
  ),
  (
    'layout_m2_por_ocupante_cocina',
    'Area por ocupante -- zona de cocina comercial (heuristica internacional, IBC Tabla 1004.5)',
    'm2/ocupante',
    'layout'
  )
ON CONFLICT (slug) DO NOTHING;


-- ---------------------------------------------------------------------
-- Parameter values. jurisdiction_id is NULL on every row: these factors are
-- national/generic, resolved with no jurisdiction override.
-- All of value_low/base/high are equal: each cited figure is a single
-- code-derived occupant-load factor, not itself a range, and inventing a
-- spread around it without a second citable source would fabricate
-- precision the source does not support (same reasoning as the capacity
-- migration).
-- No UNIQUE constraint exists on content.parameter_value, so this guards on
-- (parameter_table_id, business_type_id, jurisdiction_id IS NULL, valid_from).
-- ---------------------------------------------------------------------
INSERT INTO content.parameter_value
  (parameter_table_id, business_type_id, jurisdiction_id, value_low, value_base, value_high,
   currency, valid_from, citation_id, provenance)
SELECT pt.id, bt.id, NULL, v.value, v.value, v.value, NULL, DATE '2026-08-16', c.id, 'estimado'
FROM (VALUES
  ('layout_m2_por_ocupante_almacen', 'colmado',     27.87,
   'Table 1004.5 — Storage, stock, shipping areas'),
  ('layout_m2_por_ocupante_almacen', 'minimarket',  27.87,
   'Table 1004.5 — Storage, stock, shipping areas'),
  ('layout_m2_por_ocupante_almacen', 'ferreteria',  27.87,
   'Table 1004.5 — Storage, stock, shipping areas'),
  ('layout_m2_por_ocupante_cocina',  'restaurante', 18.58,
   'Table 1004.5 — Kitchens, commercial')
) AS v(table_slug, business_type_slug, value, cite_article)
JOIN content.parameter_table pt ON pt.slug = v.table_slug
JOIN content.business_type   bt ON bt.slug = v.business_type_slug
JOIN content.citation        c  ON c.article_ref = v.cite_article
  AND c.document_title = 'International Building Code (IBC) — Table 1004.5, Maximum Floor Area Allowances Per Occupant'
WHERE NOT EXISTS (
  SELECT 1 FROM content.parameter_value pv
  WHERE pv.parameter_table_id = pt.id AND pv.business_type_id = bt.id
    AND pv.jurisdiction_id IS NULL AND pv.valid_from = '2026-08-16'::date
);


-- Down Migration

DELETE FROM content.parameter_value pv
USING content.parameter_table pt
WHERE pv.parameter_table_id = pt.id
  AND pt.slug IN ('layout_m2_por_ocupante_almacen', 'layout_m2_por_ocupante_cocina');

DELETE FROM content.parameter_table
WHERE slug IN ('layout_m2_por_ocupante_almacen', 'layout_m2_por_ocupante_cocina');

-- Filtered by article_ref, NOT by document_title: the B-11 capacity migration
-- inserted other citation rows under the same document_title and owns their
-- removal in its own Down Migration.
DELETE FROM content.citation
WHERE document_title = 'International Building Code (IBC) — Table 1004.5, Maximum Floor Area Allowances Per Occupant'
  AND article_ref IN (
    'Table 1004.5 — Storage, stock, shipping areas',
    'Table 1004.5 — Kitchens, commercial'
  );
