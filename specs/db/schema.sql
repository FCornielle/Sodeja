-- =====================================================================
-- SODEJA — MVP Database Schema (Phase 1)
-- Postgres 15+ / PostGIS 3.3+
--
-- SPEC ONLY. Not a migration. Migrations are generated from this in B-2.
--
-- INFRASTRUCTURE POSTURE (product decision 2026-07-25): free/local tiers only.
-- Runs on local Postgres+PostGIS (Docker) or the Supabase FREE tier. No paid
-- plan may be provisioned without explicit product-owner approval.
--
-- Identity: references to auth.users(id) below follow Supabase's convention.
-- On local Postgres, B-2 creates an equivalent `auth.users(id uuid primary key)`
-- table and a stub `auth.uid()` reading a session GUC. Keeping the same names
-- means the schema and every RLS policy are identical in both environments —
-- the auth provider is swappable without touching this file.
--
-- Scope: Modules 1, 2 (footprint retrieval), 3, 4, 5, 6, 7, 9, 10,
--        12 (narrow), 13 (summary tier). Modules 8 and 11 are Phase 2.
--
-- Reading order: schemas -> domains/enums -> geo -> content -> app -> RLS.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- pgvector is deferred to Phase 2 (semantic search over regulation text, B-25).


-- =====================================================================
-- 1. SCHEMAS — the licence boundary is physical, not documentary
-- =====================================================================
-- Splitting by licence tier rather than by subject area is deliberate. Mixing
-- storable open data with non-redistributable provider content in one table
-- creates a compliance problem that is expensive to unwind later (risk L4/L6),
-- and makes "delete everything we are not allowed to keep" an unanswerable
-- query. Separate schemas make the boundary enforceable with GRANTs.
--
-- CORRECTED 2026-07-25 (verification E-2): the licence tier is a property of
-- (source, theme), NOT of the provider. Overture is the counter-example that
-- forced this: its *places* theme is CDLA-Permissive, but its *buildings* theme
-- inherits ODbL share-alike from OSM upstream. "Overture is permissive" is
-- therefore false as a blanket statement, and a provider-level rule would have
-- silently attached share-alike obligations to a derived building database.
-- Hence geo.license_class below, carried per record rather than per table.

CREATE SCHEMA IF NOT EXISTS geo;        -- storable, redistributable reference data
CREATE SCHEMA IF NOT EXISTS ephemeral;  -- provider content under caching limits; TTL-enforced
CREATE SCHEMA IF NOT EXISTS content;    -- curated editorial content: rules, rates, benchmarks
CREATE SCHEMA IF NOT EXISTS app;        -- user-owned data (projects and their outputs)

COMMENT ON SCHEMA ephemeral IS
  'Provider content that may NOT be retained indefinitely. Google Places terms as '
  'reported allow place_id indefinitely and coordinates <=30 days; everything else '
  'must expire. A scheduled reaper enforces expires_at. Ingestion jobs are granted '
  'no write access to this schema and it is excluded from logical backups.';


-- =====================================================================
-- 2. DOMAINS AND ENUMS
-- =====================================================================

-- Monetary values are ALWAYS an (amount, currency) pair, never a bare numeric.
-- DR commercial leases are frequently quoted in USD while revenue and payroll
-- are DOP, so a single-currency column would be silently wrong for a large share
-- of real users. Retrofitting currency into a finance schema after launch means
-- rewriting every stored projection, so this is designed in from the start.
--
-- Paired columns (x_amount + x_currency) are used rather than a Postgres
-- composite type: composites lose CHECK constraints and index support, and are
-- awkward through every ORM and JSON serialiser. The cost is column verbosity,
-- which is the cheaper of the two problems.
CREATE DOMAIN content.currency_code AS char(3)
  CHECK (VALUE IN ('DOP', 'USD'));

-- numeric(18,4) throughout: DOP amounts reach 8-9 significant digits for
-- fit-out budgets, and 4 decimal places are needed for FX rates and per-unit
-- rates. Never float — binary floating point does not belong anywhere near
-- money a user may show a lender.
CREATE DOMAIN content.money_amount AS numeric(18,4);

-- Every assumption carries where its value came from. This tag is rendered in
-- the UI and in the PDF assumptions appendix; it is the primary mitigation for
-- risk D1 (confident-looking output from unreliable inputs).
CREATE TYPE content.provenance AS ENUM (
  'usuario',              -- the user typed or drew it; authoritative
  'referencia_sectorial', -- curated sector benchmark, has a citation
  'estimado'              -- model-derived; the weakest tier, must be labelled
);

-- How the site area was established. MVP posture (risk T1): dataset-derived
-- area is a SUGGESTION. Reported area error of +/-20-40% would otherwise
-- propagate through capacity into a break-even figure a user might borrow
-- against, so a projection cannot be produced from an unconfirmed area.
CREATE TYPE app.area_source AS ENUM (
  'footprint_dataset',
  'user_drawn',
  'user_entered'
);

CREATE TYPE app.project_status AS ENUM ('draft', 'complete', 'archived');

CREATE TYPE content.pack_status AS ENUM (
  'draft', 'in_review', 'published', 'superseded'
);

-- Deliberately has no 'compliant' / 'cleared' member. Module 12 is a
-- non-exhaustive checklist (risk L3): a false negative could mean a user opens a
-- business and is shut down after fit-out capital is spent. The type system is
-- the cheapest place to make that affordance unrepresentable.
CREATE TYPE content.permit_requirement AS ENUM (
  'required', 'likely_required', 'not_applicable', 'unknown'
);

-- Surfaced per analysis so that thin data coverage reads as "we do not know"
-- rather than "there is no competition here" (risk D3).
CREATE TYPE content.confidence_tier AS ENUM (
  'alta', 'media', 'baja', 'insuficiente'
);

-- Redistribution class, per (source, theme). Drives whether a derived product
-- may be published without share-alike obligations attaching, and is checked
-- before any bulk export or partner feed — not merely documented.
CREATE TYPE geo.license_class AS ENUM (
  'permissive',   -- CDLA-Permissive-2.0, CC BY, CC BY-IGO: attribution only
  'share_alike'   -- ODbL: derived databases may inherit obligations
);

-- DR company size is a LEGAL determination from dual criteria (headcount AND
-- annual gross sales, per Ley 488-08 / MICM Res. 79-2025) — not a value the
-- user picks. It selects which statutory wage floor applies, so misclassifying
-- it produces a wrong payroll number with a confident face on it.
CREATE TYPE content.company_size AS ENUM (
  'micro', 'pequena', 'mediana', 'grande'
);

CREATE TYPE app.report_tier AS ENUM (
  'resumen_analisis',  -- Phase 1: watermarked summary
  'plan_negocio'       -- Phase 2 only (B-26), gated on ground-truth validation
);

CREATE TYPE app.report_status AS ENUM ('queued', 'rendering', 'ready', 'failed');


-- =====================================================================
-- 3. geo — ingested reference data (storable tier)
-- =====================================================================

-- Hierarchical DR administrative geography from IDE-RD. Self-referencing rather
-- than one table per level, because permit jurisdiction resolution walks this
-- tree (municipio -> province -> national) and a fixed-level design would need
-- a join per level.
CREATE TABLE geo.admin_area (
  id             bigserial PRIMARY KEY,
  parent_id      bigint REFERENCES geo.admin_area(id),
  level          text NOT NULL CHECK (level IN ('pais','provincia','municipio','seccion','barrio')),
  code           text NOT NULL,              -- official ONE / IDE-RD code
  name           text NOT NULL,
  geom           geometry(MultiPolygon, 4326) NOT NULL,
  -- Provenance columns are NOT NULL on every geo table. An unattributed row is a
  -- compliance defect, not untidy metadata: ODbL and CC BY both require
  -- attribution at the point of display (risk L6).
  source         text NOT NULL,
  source_license text NOT NULL,
  source_vintage date NOT NULL,
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (level, code)
);
CREATE INDEX admin_area_geom_gix ON geo.admin_area USING gist (geom);
CREATE INDEX admin_area_parent_ix ON geo.admin_area (parent_id);

CREATE TABLE geo.census_population (
  admin_area_id  bigint PRIMARY KEY REFERENCES geo.admin_area(id) ON DELETE CASCADE,
  population     integer NOT NULL CHECK (population >= 0),
  households     integer CHECK (households >= 0),
  census_year    smallint NOT NULL,
  source         text NOT NULL,
  source_vintage date NOT NULL
);
-- census_year is displayed in the UI, not just stored. Risk D2 is that a 2022
-- census silently reads as current; the mitigation only works if the date
-- reaches the screen.

CREATE TABLE geo.building_footprint (
  id             bigserial PRIMARY KEY,
  geom           geometry(Polygon, 4326) NOT NULL,
  -- Populated by the ingestion job rather than a GENERATED column: the correct
  -- computation is ST_Area(geom::geography) for metric area at DR latitudes, and
  -- keeping it a plain column avoids depending on that function's volatility
  -- classification across PostGIS versions.
  area_sqm       numeric(12,2) NOT NULL CHECK (area_sqm > 0),
  -- Dataset-reported detection confidence (Open Buildings publishes this).
  -- Distinct from user confirmation: high confidence still requires confirmation.
  confidence     numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  source         text NOT NULL CHECK (source IN ('open_buildings_v3','ms_globalml','overture','osm')),
  source_license text NOT NULL,
  source_vintage date NOT NULL,
  admin_area_id  bigint REFERENCES geo.admin_area(id),  -- denormalised for fast filtering
  ingested_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX building_footprint_geom_gix ON geo.building_footprint USING gist (geom);
CREATE INDEX building_footprint_area_ix ON geo.building_footprint (admin_area_id);
-- Tap-to-select is ST_Contains(geom, tap_point) over this index: the entire
-- "AI building detection" of Module 2 in Phase 1. No inference, no imagery.

-- POI from Overture Places (CDLA-Permissive, storable) ONLY.
-- Google Places content must never land here; see ephemeral.poi_provider_cache.
CREATE TABLE geo.poi_place (
  id             bigserial PRIMARY KEY,
  external_id    text NOT NULL,
  name           text,
  category       text,                  -- normalised to content.business_type.slug where possible
  raw_category   text,
  geom           geometry(Point, 4326) NOT NULL,
  admin_area_id  bigint REFERENCES geo.admin_area(id),
  source         text NOT NULL,
  source_license text NOT NULL,
  source_vintage date NOT NULL,
  -- ADDED via ALTER TABLE, B-5 (packages/db/migrations/*_add-poi-place-
  -- confidence.sql), per the P0-1 Overture coverage spike
  -- (docs/SODEJA_DATA_SOURCES.md): a majority of DR records sit below 0.7
  -- confidence, so the spike recommended keeping confidence first-class and
  -- queryable rather than silently dropping low-confidence rows at
  -- ingestion time. Nullable because Overture does not report confidence
  -- for every place the way Open Buildings does for footprints. Listed last
  -- (rather than grouped near category/raw_category) because that migration
  -- appends it after source_vintage, matching this table's real physical
  -- column order.
  confidence     numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  UNIQUE (source, external_id)
);
CREATE INDEX poi_place_geom_gix ON geo.poi_place USING gist (geom);
CREATE INDEX poi_place_category_ix ON geo.poi_place (category);

-- Pre-aggregated population/competition grid. Exists to keep Module 1 off
-- per-request polygon aggregation, which is the predictable scaling problem
-- (risk T4). Rebuilt by the ingestion service, never written at request time.
CREATE TABLE geo.population_grid (
  id                bigserial PRIMARY KEY,
  cell              geometry(Polygon, 4326) NOT NULL,
  population_est    integer NOT NULL,
  poi_count         integer NOT NULL DEFAULT 0,
  computed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX population_grid_gix ON geo.population_grid USING gist (cell);

-- Per-area data-coverage scoring. The product refuses to render an analysis
-- below a coverage threshold rather than producing a confident-looking answer
-- from thin data (risk D3). MVP launches only where the threshold is met:
-- Distrito Nacional, Santo Domingo province, Santiago.
CREATE TABLE geo.data_coverage_cell (
  id               bigserial PRIMARY KEY,
  cell             geometry(Polygon, 4326) NOT NULL,
  footprint_score  numeric(4,3) NOT NULL CHECK (footprint_score BETWEEN 0 AND 1),
  poi_score        numeric(4,3) NOT NULL CHECK (poi_score BETWEEN 0 AND 1),
  census_score     numeric(4,3) NOT NULL CHECK (census_score BETWEEN 0 AND 1),
  tier             content.confidence_tier NOT NULL,
  is_launch_area   boolean NOT NULL DEFAULT false,
  computed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX data_coverage_cell_gix ON geo.data_coverage_cell USING gist (cell);


-- =====================================================================
-- 4. ephemeral — provider content under caching restrictions
-- =====================================================================

-- Column-level split by retention right, so the reaper can null the restricted
-- fields while keeping the identifier. Modelling this as one JSON blob with a
-- single TTL would force discarding the place_id too, defeating the only
-- long-lived key the terms permit.
CREATE TABLE ephemeral.poi_provider_cache (
  provider        text NOT NULL,
  place_id        text NOT NULL,           -- retainable indefinitely (as reported)
  lon             double precision,        -- <=30 days
  lat             double precision,        -- <=30 days
  payload         jsonb,                   -- all other content: shortest TTL
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  coords_expire_at timestamptz NOT NULL,
  payload_expire_at timestamptz NOT NULL,
  PRIMARY KEY (provider, place_id)
);
CREATE INDEX poi_provider_cache_expiry_ix ON ephemeral.poi_provider_cache (payload_expire_at);

COMMENT ON TABLE ephemeral.poi_provider_cache IS
  'Retention is enforced by a scheduled job that nulls lon/lat past coords_expire_at '
  'and payload past payload_expire_at. Rows are never migrated into geo.*. '
  'If Overture coverage proves sufficient in P0-1, this table may be dropped entirely.';


-- =====================================================================
-- 5. content — curated editorial content (rules, rates, benchmarks)
-- =====================================================================

-- Jurisdiction is separate from geo.admin_area because legal jurisdiction and
-- statistical geography do not always coincide, and rule authors work in legal
-- terms. The FK is optional so a jurisdiction can exist before its geometry is
-- ingested.
CREATE TABLE content.jurisdiction (
  id            bigserial PRIMARY KEY,
  parent_id     bigint REFERENCES content.jurisdiction(id),
  level         text NOT NULL CHECK (level IN ('nacional','provincia','municipio')),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  admin_area_id bigint REFERENCES geo.admin_area(id)
);

-- Mandatory on every rule and every parameter value. Enforced by NOT NULL FKs
-- below rather than by editorial convention: an unsourceable rule is
-- unpublishable, because the UI is required to render the source and effective
-- date next to every answer (risk T3).
CREATE TABLE content.citation (
  id              bigserial PRIMARY KEY,
  source_name     text NOT NULL,          -- e.g. 'DGII', 'Ayuntamiento del Distrito Nacional'
  document_title  text NOT NULL,          -- e.g. 'Decreto 265-19'
  article_ref     text,                   -- e.g. 'Art. 12'
  source_url      text,
  published_on    date,
  retrieved_on    date NOT NULL,
  -- Set true only for figures confirmed against a primary source. The Data
  -- Sources doc lists several unresolved conflicts (RST threshold, retencion
  -- rate); those rows stay false and must not be published.
  is_verified     boolean NOT NULL DEFAULT false,
  verification_note text
);

CREATE TABLE content.rule_pack (
  id              bigserial PRIMARY KEY,
  jurisdiction_id bigint NOT NULL REFERENCES content.jurisdiction(id),
  domain          text NOT NULL CHECK (domain IN ('permits','tax','labor','zoning')),
  version         integer NOT NULL,
  status          content.pack_status NOT NULL DEFAULT 'draft',
  valid_from      date NOT NULL,
  valid_to        date,                   -- NULL = currently in force
  published_at    timestamptz,
  published_by    uuid,                   -- auth.users(id) of the content editor
  notes           text,
  UNIQUE (jurisdiction_id, domain, version),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);
-- Packs are append-only: publishing supersedes the prior version rather than
-- mutating it. Any historical report must remain explainable in terms of the
-- pack that produced it, which is impossible if content is edited in place.

CREATE TABLE content.rule (
  id            bigserial PRIMARY KEY,
  rule_pack_id  bigint NOT NULL REFERENCES content.rule_pack(id) ON DELETE CASCADE,
  code          text NOT NULL,
  title_es      text NOT NULL,
  description_es text,
  -- Declarative JSONLogic, interpreted by @sodeja/rules. NOT executable code and
  -- NOT a code path: a rate or requirement change must be a content edit, never
  -- a deploy (risk T3). A non-Turing-complete DSL also means a malformed rule
  -- authored by a non-engineer cannot hang or crash the API.
  condition     jsonb NOT NULL,
  consequence   jsonb NOT NULL,
  requirement   content.permit_requirement,
  agency_name   text,
  citation_id   bigint NOT NULL REFERENCES content.citation(id),
  display_order integer NOT NULL DEFAULT 0,
  UNIQUE (rule_pack_id, code)
);

-- Dated scalars read by @sodeja/calc via asOfDate. The engine knows HOW to
-- compute, never WHAT the current rate is: ITBIS, ISR brackets, TSS ceilings,
-- minimum wages, capacity ratios and fit-out uplifts all live here. There are no
-- business-meaningful numeric literals in application code.
CREATE TABLE content.parameter_table (
  id          bigserial PRIMARY KEY,
  slug        text NOT NULL UNIQUE,   -- e.g. 'itbis','tss_employer','capacity_ratio_restaurante'
  name_es     text NOT NULL,
  unit        text NOT NULL,          -- 'ratio','DOP','DOP/m2','m2/asiento','percent'
  domain      text NOT NULL CHECK (domain IN ('tax','labor','construction','capacity','layout','rent','utilities'))
);

CREATE TABLE content.parameter_value (
  id                  bigserial PRIMARY KEY,
  parameter_table_id  bigint NOT NULL REFERENCES content.parameter_table(id) ON DELETE CASCADE,
  business_type_id    bigint,          -- FK added after business_type; NULL = applies to all
  jurisdiction_id     bigint REFERENCES content.jurisdiction(id),
  -- Three-point values, not one. Every benchmark SODEJA publishes is a band;
  -- point estimates are the mechanism by which risk D1 does its damage. Where a
  -- figure is exact (a statutory rate), all three columns hold the same value —
  -- which is itself informative to the reader.
  value_low           numeric(18,6) NOT NULL,
  value_base          numeric(18,6) NOT NULL,
  value_high          numeric(18,6) NOT NULL,
  currency            content.currency_code,   -- NULL for unitless ratios
  valid_from          date NOT NULL,
  valid_to            date,
  citation_id         bigint NOT NULL REFERENCES content.citation(id),
  provenance          content.provenance NOT NULL,
  CHECK (value_low <= value_base AND value_base <= value_high),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX parameter_value_lookup_ix
  ON content.parameter_value (parameter_table_id, business_type_id, valid_from DESC);

-- Catalog only. Every NUMBER associated with a business type lives in
-- parameter_value, so adding a sector or retuning a ratio is a content edit.
-- MVP launches with 4-6 rows: restaurante, colmado, ferreteria, salon, minimarket.
CREATE TABLE content.business_type (
  id             bigserial PRIMARY KEY,
  slug           text NOT NULL UNIQUE,
  name_es        text NOT NULL,
  description_es text,
  is_active      boolean NOT NULL DEFAULT false,  -- gate for staged sector rollout
  display_order  integer NOT NULL DEFAULT 0
);

ALTER TABLE content.parameter_value
  ADD CONSTRAINT parameter_value_business_type_fk
  FOREIGN KEY (business_type_id) REFERENCES content.business_type(id) ON DELETE CASCADE;

-- Module 4 typology templates. Ratios are international, NOT DR-specific
-- (no DR space-planning standard was found) — the citation and the
-- ratio_origin_note both exist so the UI can say so out loud (risk D5).
CREATE TABLE content.layout_template (
  id               bigserial PRIMARY KEY,
  business_type_id bigint NOT NULL REFERENCES content.business_type(id) ON DELETE CASCADE,
  zone_slug        text NOT NULL,        -- 'salon','cocina','almacen','bano','circulacion'
  name_es          text NOT NULL,
  share_of_area_low  numeric(4,3) NOT NULL CHECK (share_of_area_low BETWEEN 0 AND 1),
  share_of_area_base numeric(4,3) NOT NULL CHECK (share_of_area_base BETWEEN 0 AND 1),
  share_of_area_high numeric(4,3) NOT NULL CHECK (share_of_area_high BETWEEN 0 AND 1),
  citation_id      bigint NOT NULL REFERENCES content.citation(id),
  ratio_origin_note text NOT NULL,
  UNIQUE (business_type_id, zone_slug),
  CHECK (share_of_area_low <= share_of_area_base AND share_of_area_base <= share_of_area_high)
);


-- =====================================================================
-- 6. app — user-owned data
-- =====================================================================
-- Identity is Supabase auth.users; this schema never stores credentials.

CREATE TABLE app.user_profile (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text,
  locale        text NOT NULL DEFAULT 'es-DO',
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Set when the user requests erasure (Ley 172-13). Deletion is a queued job,
  -- not a cascade, because reports in object storage must be removed too.
  deletion_requested_at timestamptz
);

-- Versioned legal documents. Acceptance must be provable per version: the
-- limitation-of-liability text a user agreed to is the one in force when they
-- exported a projection they may have acted on (risk L1).
CREATE TABLE app.legal_document (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('tos','privacy','disclaimer')),
  version      text NOT NULL,
  locale       text NOT NULL DEFAULT 'es-DO',
  body_md      text NOT NULL,
  effective_from date NOT NULL,
  UNIQUE (kind, version, locale)
);

CREATE TABLE app.legal_acceptance (
  id                bigserial PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  legal_document_id bigint NOT NULL REFERENCES app.legal_document(id),
  accepted_at       timestamptz NOT NULL DEFAULT now(),
  ip_inet           inet,        -- evidentiary only; excluded from all logs
  UNIQUE (user_id, legal_document_id)
);

-- Ley 172-13 requires granular, separately revocable consent. Modelled as rows
-- rather than boolean columns so revocation is an append (auditable) rather than
-- an overwrite. Precise location is separately revocable because manual pin
-- placement must keep working without it (risk L5).
CREATE TABLE app.consent (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN
                ('precise_location','analytics','marketing','cross_border_transfer')),
  granted     boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_current_ix ON app.consent (user_id, purpose, recorded_at DESC);

-- ---------------------------------------------------------------------
-- Tenancy groundwork — DELIBERATELY MINIMAL
--
-- Product decision (2026-07-25): lay the tenancy rails now, keep the MVP
-- functionally single-tenant. What exists: the org table, one auto-created
-- personal org per user, and org-scoped RLS layered on top of user-scoped RLS.
-- What does NOT exist and must not be built yet: organization management,
-- invitations, roles/permissions, billing, or any B2B workflow.
--
-- The reasoning for doing it now rather than later: org_id touches the RLS
-- policy of every tenant-owned table, and retrofitting that after launch means
-- backfilling live user data behind a security boundary. The column is cheap
-- today and expensive in a year.
-- ---------------------------------------------------------------------

CREATE TABLE app.organization (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  -- True for the auto-created personal org. Every MVP org is personal; the flag
  -- exists so that a future real organization is distinguishable from the
  -- millions of single-user orgs that will already exist by then.
  is_personal    boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_owner_ix ON app.organization (owner_user_id);

-- Created on signup (Supabase auth trigger) or lazily on first project write,
-- whichever B-2 finds simpler to make idempotent. Every user has exactly one
-- personal org in the MVP, so no membership table is needed yet.
CREATE UNIQUE INDEX organization_one_personal_per_user_ix
  ON app.organization (owner_user_id) WHERE is_personal;

-- THE seam that keeps this decision cheap. Every org-scoped RLS policy calls
-- this function rather than inlining `owner_user_id = auth.uid()`. When real
-- multi-tenancy arrives, a membership table is added and ONLY this function
-- body changes — no policy is rewritten, and no table is re-secured.
CREATE FUNCTION app.current_org_ids()
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_catalog
AS $$
  SELECT id FROM app.organization WHERE owner_user_id = auth.uid();
$$;

-- The project aggregate. One canonical assumption set per project, so Module 7
-- and (later) Module 8 cannot disagree about the same site (risk T6).
CREATE TABLE app.project (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Tenant scope. Carried by the aggregate ROOT only: child tables
  -- (project_location, assumptions, estimates, projection, report, ...) reach
  -- it through their existing FK to project, so their RLS policies gain the org
  -- check without a denormalised column that could drift out of sync.
  -- A future tenant-owned table that is NOT a child of project gets its own
  -- org_id column and its own policy.
  org_id            uuid NOT NULL REFERENCES app.organization(id) ON DELETE CASCADE,
  name              text NOT NULL,
  status            app.project_status NOT NULL DEFAULT 'draft',
  business_type_id  bigint REFERENCES content.business_type(id),
  jurisdiction_id   bigint REFERENCES content.jurisdiction(id),
  -- Scenario-level currency posture. reporting_currency is what the user sees;
  -- fx_rate is pinned per project so a projection does not silently change
  -- meaning when the exchange rate moves. Stored, not fetched at render time.
  reporting_currency content.currency_code NOT NULL DEFAULT 'DOP',
  fx_usd_dop        numeric(12,6),
  fx_rate_as_of     date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_owner_ix ON app.project (owner_id, updated_at DESC);
CREATE INDEX project_org_ix ON app.project (org_id, updated_at DESC);

-- The site under study. Separate from project because a project may re-point at
-- a different site while keeping its assumption set.
CREATE TABLE app.project_location (
  project_id      uuid PRIMARY KEY REFERENCES app.project(id) ON DELETE CASCADE,
  geom            geometry(Polygon, 4326),          -- confirmed or drawn outline
  centroid        geometry(Point, 4326) NOT NULL,
  address_text    text,
  admin_area_id   bigint REFERENCES geo.admin_area(id),
  -- Suggestion from geo.building_footprint, retained for accuracy telemetry.
  suggested_footprint_id bigint REFERENCES geo.building_footprint(id),
  suggested_area_sqm     numeric(12,2),
  -- The area actually used by every downstream calculation.
  area_sqm        numeric(12,2) CHECK (area_sqm > 0),
  area_source     app.area_source NOT NULL,
  -- Hard gate. No capacity estimate, projection, or report may be produced from
  -- an unconfirmed area (risk T1). Enforced in the API and asserted here.
  area_confirmed_at timestamptz,
  -- Continuous accuracy signal for B-22/D4: the delta between suggested and
  -- confirmed area, measured across real users, is the only honest basis for
  -- ever publishing an accuracy claim.
  coverage_tier   content.confidence_tier NOT NULL DEFAULT 'insuficiente',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (area_confirmed_at IS NULL OR area_sqm IS NOT NULL)
);
CREATE INDEX project_location_centroid_gix ON app.project_location USING gist (centroid);

-- Every input to every calculation, in one place, individually editable and
-- individually provenance-tagged. A row-per-assumption design (rather than a
-- JSON blob on the project) is what makes "show me every assumption and let me
-- override any of them" a query instead of a special case — and it is what the
-- PDF assumptions appendix reads.
CREATE TABLE app.project_assumption (
  id              bigserial PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
  key             text NOT NULL,              -- e.g. 'ticket_promedio','rotacion_mesas'
  label_es        text NOT NULL,
  unit            text NOT NULL,
  value_low       numeric(18,6) NOT NULL,
  value_base      numeric(18,6) NOT NULL,
  value_high      numeric(18,6) NOT NULL,
  currency        content.currency_code,
  provenance      content.provenance NOT NULL,
  -- Where the pre-filled default came from, and whether the user moved it.
  -- Overrides are instrumented: a systematically overridden default is a signal
  -- the benchmark is wrong.
  default_parameter_value_id bigint REFERENCES content.parameter_value(id),
  is_overridden   boolean NOT NULL DEFAULT false,
  -- Set when a user value falls outside the curated plausibility band. Surfaced
  -- as a warning, never a block: the user may know their market better than the
  -- benchmark does (risk D1).
  implausible_flag boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, key),
  CHECK (value_low <= value_base AND value_base <= value_high)
);

-- ---------------------------------------------------------------------
-- Calculation outputs (Modules 6, 9, 10, 7)
--
-- All four share one pattern: pinned engine_version, a complete inputs_snapshot,
-- and three-point results. The snapshot is what makes a report reproducible
-- months later without re-querying content that may since have changed —
-- history is never silently recomputed against a newer engine or rate table.
-- results_json holds the detailed line items; headline figures are promoted to
-- typed columns so they are queryable and constrainable.
-- ---------------------------------------------------------------------

CREATE TABLE app.capacity_estimate (
  id              bigserial PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
  engine_version  text NOT NULL,
  as_of_date      date NOT NULL,
  inputs_snapshot jsonb NOT NULL,
  results_json    jsonb NOT NULL,
  seats_low       integer, seats_base integer, seats_high integer,
  staff_low       integer, staff_base integer, staff_high integer,
  daily_customers_low integer, daily_customers_base integer, daily_customers_high integer,
  computed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX capacity_estimate_project_ix ON app.capacity_estimate (project_id, computed_at DESC);

CREATE TABLE app.fitout_estimate (
  id              bigserial PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
  engine_version  text NOT NULL,
  as_of_date      date NOT NULL,
  inputs_snapshot jsonb NOT NULL,
  results_json    jsonb NOT NULL,          -- per-zone and per-trade breakdown
  total_low_amount   content.money_amount NOT NULL,
  total_base_amount  content.money_amount NOT NULL,
  total_high_amount  content.money_amount NOT NULL,
  currency           content.currency_code NOT NULL,
  -- Anchored on a HOUSING construction index with curated business-type
  -- uplifts. No public DR commercial fit-out benchmark was found, so bands are
  -- wide and the UI must label the figure indicative, not authoritative.
  index_base_date    date NOT NULL,
  computed_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (total_low_amount <= total_base_amount AND total_base_amount <= total_high_amount)
);

CREATE TABLE app.opex_estimate (
  id              bigserial PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
  engine_version  text NOT NULL,
  as_of_date      date NOT NULL,
  inputs_snapshot jsonb NOT NULL,
  -- Line items keyed by category: payroll, tss, rent, utilities, supplies,
  -- other. Payroll/TSS rest on official published figures; rent and utilities
  -- are curated ranges. Utilities must account for generator/inverter cost,
  -- which is a normal operating reality in the DR rather than an edge case.
  results_json    jsonb NOT NULL,
  monthly_low_amount  content.money_amount NOT NULL,
  monthly_base_amount content.money_amount NOT NULL,
  monthly_high_amount content.money_amount NOT NULL,
  currency            content.currency_code NOT NULL,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (monthly_low_amount <= monthly_base_amount AND monthly_base_amount <= monthly_high_amount)
);

-- The integration point. Four hard upstream dependencies (B-11, B-12, B-14,
-- B-15) and the highest-consequence output in the product: a user may borrow
-- against a break-even figure.
CREATE TABLE app.financial_projection (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
  engine_version  text NOT NULL,
  -- Every content version that contributed, pinned. Without these a
  -- regenerated report could differ from the original with no way to explain why.
  rule_pack_ids   bigint[] NOT NULL DEFAULT '{}',
  as_of_date      date NOT NULL,
  fx_usd_dop      numeric(12,6),
  inputs_snapshot jsonb NOT NULL,
  results_json    jsonb NOT NULL,          -- monthly series, P&L, cash flow, sensitivity
  -- Break-even as a RANGE in months, nullable because it legitimately may not
  -- occur within the projection horizon. A NULL here must render as "no alcanza
  -- el punto de equilibrio en el horizonte proyectado", never as zero.
  breakeven_month_low  smallint,
  breakeven_month_base smallint,
  breakeven_month_high smallint,
  currency        content.currency_code NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX financial_projection_project_ix ON app.financial_projection (project_id, computed_at DESC);

-- Module 1 output. Demand is a MODEL OUTPUT, not a measurement — the column
-- name says est and the confidence tier travels with it (risks D2, D3).
CREATE TABLE app.market_study (
  project_id        uuid PRIMARY KEY REFERENCES app.project(id) ON DELETE CASCADE,
  engine_version    text NOT NULL,
  radius_m          integer NOT NULL,
  population_est    integer NOT NULL,
  competitor_count  integer NOT NULL,
  -- Competitors the user observed on the ground. Informal businesses are
  -- invisible to every available dataset, so manual addition is a first-class
  -- input rather than a fallback (risk D2).
  competitors_user_added integer NOT NULL DEFAULT 0,
  demand_index_low  numeric(10,4), demand_index_base numeric(10,4), demand_index_high numeric(10,4),
  confidence        content.confidence_tier NOT NULL,
  census_year       smallint NOT NULL,
  poi_vintage       date,
  computed_at       timestamptz NOT NULL DEFAULT now()
);

-- Module 12. Materialised per project from the rule pack, so the checklist a
-- user saw remains reconstructible after the pack is superseded.
CREATE TABLE app.permit_checklist_item (
  id              bigserial PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
  rule_id         bigint REFERENCES content.rule(id),
  rule_pack_id    bigint NOT NULL REFERENCES content.rule_pack(id),
  title_es        text NOT NULL,
  agency_name     text,
  requirement     content.permit_requirement NOT NULL,
  citation_id     bigint NOT NULL REFERENCES content.citation(id),
  -- User's own tracking. Note this is the USER asserting progress, not SODEJA
  -- certifying anything; there is no state meaning "compliant" (risk L3).
  user_marked_done boolean NOT NULL DEFAULT false,
  display_order   integer NOT NULL DEFAULT 0,
  generated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX permit_checklist_project_ix ON app.permit_checklist_item (project_id, display_order);

-- Module 13. Async render job; see services/pdf-worker.
CREATE TABLE app.report (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
  requested_by         uuid NOT NULL REFERENCES auth.users(id),
  tier                 app.report_tier NOT NULL DEFAULT 'resumen_analisis',
  status               app.report_status NOT NULL DEFAULT 'queued',
  -- Pinned so a re-export is byte-comparable to the original, and so a dispute
  -- can be answered with exactly what the user was shown (risks L1, L7).
  financial_projection_id uuid REFERENCES app.financial_projection(id),
  engine_version       text,
  disclaimer_document_id bigint REFERENCES app.legal_document(id),
  storage_key          text,
  failure_reason       text,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  CHECK (status <> 'ready' OR (storage_key IS NOT NULL AND disclaimer_document_id IS NOT NULL))
);
-- The CHECK is the enforcement point for "no export without a disclaimer".
-- Making it a database constraint rather than application logic means the
-- compliance requirement cannot be bypassed by a new code path.


-- =====================================================================
-- 7. ROW-LEVEL SECURITY
-- =====================================================================
-- RLS is the actual enforcement layer, not defence in depth. An authorization
-- bug in application code still cannot leak another user's project (risk T7).
-- Policies are written against auth.uid() from the Supabase JWT.

ALTER TABLE app.organization           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_profile           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.legal_acceptance       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.consent                ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.project                ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.project_location       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.project_assumption     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.capacity_estimate      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fitout_estimate        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.opex_estimate          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.financial_projection   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.market_study           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.permit_checklist_item  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.report                 ENABLE ROW LEVEL SECURITY;

-- User-level scoping. Profiles, legal acceptances and consents belong to the
-- PERSON, not the org: an accepted ToS or a revoked location consent must not
-- become an organizational asset if B2B ever ships. These stay user-scoped
-- permanently and deliberately.
CREATE POLICY own_profile ON app.user_profile
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY own_organization ON app.organization
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

-- Tenant-owned data carries BOTH checks. In the MVP the two are equivalent —
-- one user, one personal org — so the org clause is currently redundant. That
-- is the point: the enforcement path is exercised from day one, so enabling
-- real multi-tenancy later is a change to app.current_org_ids() rather than a
-- security-boundary migration on live data.
CREATE POLICY own_project ON app.project
  USING (owner_id = auth.uid() AND org_id IN (SELECT app.current_org_ids()))
  WITH CHECK (owner_id = auth.uid() AND org_id IN (SELECT app.current_org_ids()));

-- Child tables inherit both scopes through the project. Written once per table
-- because Postgres has no policy inheritance; the EXISTS form lets the planner
-- use project_owner_ix / project_org_ix.
CREATE POLICY own_project_child ON app.project_location
  USING (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = project_location.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())));
-- ... the same policy shape is applied to project_assumption, capacity_estimate,
-- fitout_estimate, opex_estimate, financial_projection, market_study,
-- permit_checklist_item, and report. Generated in the B-2 migration rather than
-- hand-repeated here.

-- Reference and published content are readable by any authenticated user;
-- writes are restricted to the service role and the content-editor role.
-- geo.* and content.* intentionally have RLS disabled: they contain no
-- user-owned rows, and enabling it would add a per-row check to every spatial
-- query on the hot path (risk T4).
GRANT USAGE ON SCHEMA geo, content TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA geo TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA content TO authenticated;

-- No role other than the provider-proxy service may touch the ephemeral schema.
REVOKE ALL ON SCHEMA ephemeral FROM authenticated;
