-- Up Migration
-- =====================================================================
-- SODEJA — Initial schema (B-2)
--
-- Generated from the approved spec at specs/db/schema.sql. That file is the
-- source of truth for table/column rationale; this migration reproduces it
-- verbatim and adds exactly the pieces specs/db/schema.sql explicitly defers
-- to B-2: a local Supabase-equivalent identity layer, and the RLS policies
-- it left as "generated in the B-2 migration rather than hand-repeated
-- here". Nothing here changes the approved schema's shape.
-- =====================================================================


-- =====================================================================
-- 0. LOCAL AUTH EQUIVALENT (not in specs/db/schema.sql by design)
--
-- specs/db/schema.sql assumes Supabase's auth.users/auth.uid() convention so
-- the schema and every RLS policy are identical under either provider. This
-- project runs local/open-source tools only (no hosted Supabase project), so
-- this section builds the equivalent: a minimal auth.users table, and a
-- auth.uid() stub reading the same session GUC PostgREST/Supabase would set
-- from a verified JWT (request.jwt.claim.sub). Swapping to real Supabase
-- later means pointing DATABASE_URL at it and dropping this section — no
-- application code or policy changes.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
  RETURNS uuid
  LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Supabase provisions these roles automatically; on local Postgres B-2 must.
-- `authenticated` is the role every RLS-scoped session runs as (see
-- packages/db/src/session.ts, withUserSession). `service_role` bypasses RLS
-- for migrations and ingestion jobs, mirroring Supabase's service key.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;


-- =====================================================================
-- specs/db/schema.sql, reproduced verbatim from here
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

CREATE DOMAIN content.currency_code AS char(3)
  CHECK (VALUE IN ('DOP', 'USD'));

CREATE DOMAIN content.money_amount AS numeric(18,4);

CREATE TYPE content.provenance AS ENUM (
  'usuario',              -- the user typed or drew it; authoritative
  'referencia_sectorial', -- curated sector benchmark, has a citation
  'estimado'              -- model-derived; the weakest tier, must be labelled
);

CREATE TYPE app.area_source AS ENUM (
  'footprint_dataset',
  'user_drawn',
  'user_entered'
);

CREATE TYPE app.project_status AS ENUM ('draft', 'complete', 'archived');

CREATE TYPE content.pack_status AS ENUM (
  'draft', 'in_review', 'published', 'superseded'
);

CREATE TYPE content.permit_requirement AS ENUM (
  'required', 'likely_required', 'not_applicable', 'unknown'
);

CREATE TYPE content.confidence_tier AS ENUM (
  'alta', 'media', 'baja', 'insuficiente'
);

CREATE TYPE geo.license_class AS ENUM (
  'permissive',   -- CDLA-Permissive-2.0, CC BY, CC BY-IGO: attribution only
  'share_alike'   -- ODbL: derived databases may inherit obligations
);

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

CREATE TABLE geo.admin_area (
  id             bigserial PRIMARY KEY,
  parent_id      bigint REFERENCES geo.admin_area(id),
  level          text NOT NULL CHECK (level IN ('pais','provincia','municipio','seccion','barrio')),
  code           text NOT NULL,              -- official ONE / IDE-RD code
  name           text NOT NULL,
  geom           geometry(MultiPolygon, 4326) NOT NULL,
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

CREATE TABLE geo.building_footprint (
  id             bigserial PRIMARY KEY,
  geom           geometry(Polygon, 4326) NOT NULL,
  area_sqm       numeric(12,2) NOT NULL CHECK (area_sqm > 0),
  confidence     numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  source         text NOT NULL CHECK (source IN ('open_buildings_v3','ms_globalml','overture','osm')),
  source_license text NOT NULL,
  source_vintage date NOT NULL,
  admin_area_id  bigint REFERENCES geo.admin_area(id),
  ingested_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX building_footprint_geom_gix ON geo.building_footprint USING gist (geom);
CREATE INDEX building_footprint_area_ix ON geo.building_footprint (admin_area_id);

CREATE TABLE geo.poi_place (
  id             bigserial PRIMARY KEY,
  external_id    text NOT NULL,
  name           text,
  category       text,
  raw_category   text,
  geom           geometry(Point, 4326) NOT NULL,
  admin_area_id  bigint REFERENCES geo.admin_area(id),
  source         text NOT NULL,
  source_license text NOT NULL,
  source_vintage date NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX poi_place_geom_gix ON geo.poi_place USING gist (geom);
CREATE INDEX poi_place_category_ix ON geo.poi_place (category);

CREATE TABLE geo.population_grid (
  id                bigserial PRIMARY KEY,
  cell              geometry(Polygon, 4326) NOT NULL,
  population_est    integer NOT NULL,
  poi_count         integer NOT NULL DEFAULT 0,
  computed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX population_grid_gix ON geo.population_grid USING gist (cell);

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

CREATE TABLE content.jurisdiction (
  id            bigserial PRIMARY KEY,
  parent_id     bigint REFERENCES content.jurisdiction(id),
  level         text NOT NULL CHECK (level IN ('nacional','provincia','municipio')),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  admin_area_id bigint REFERENCES geo.admin_area(id)
);

CREATE TABLE content.citation (
  id              bigserial PRIMARY KEY,
  source_name     text NOT NULL,          -- e.g. 'DGII', 'Ayuntamiento del Distrito Nacional'
  document_title  text NOT NULL,          -- e.g. 'Decreto 265-19'
  article_ref     text,                   -- e.g. 'Art. 12'
  source_url      text,
  published_on    date,
  retrieved_on    date NOT NULL,
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

CREATE TABLE content.rule (
  id            bigserial PRIMARY KEY,
  rule_pack_id  bigint NOT NULL REFERENCES content.rule_pack(id) ON DELETE CASCADE,
  code          text NOT NULL,
  title_es      text NOT NULL,
  description_es text,
  condition     jsonb NOT NULL,
  consequence   jsonb NOT NULL,
  requirement   content.permit_requirement,
  agency_name   text,
  citation_id   bigint NOT NULL REFERENCES content.citation(id),
  display_order integer NOT NULL DEFAULT 0,
  UNIQUE (rule_pack_id, code)
);

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

CREATE TABLE app.user_profile (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text,
  locale        text NOT NULL DEFAULT 'es-DO',
  created_at    timestamptz NOT NULL DEFAULT now(),
  deletion_requested_at timestamptz
);

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

CREATE TABLE app.consent (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN
                ('precise_location','analytics','marketing','cross_border_transfer')),
  granted     boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_current_ix ON app.consent (user_id, purpose, recorded_at DESC);

CREATE TABLE app.organization (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  is_personal    boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_owner_ix ON app.organization (owner_user_id);

CREATE UNIQUE INDEX organization_one_personal_per_user_ix
  ON app.organization (owner_user_id) WHERE is_personal;

CREATE FUNCTION app.current_org_ids()
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_catalog
AS $$
  SELECT id FROM app.organization WHERE owner_user_id = auth.uid();
$$;

-- specs/db/schema.sql leaves the choice open: "created on signup (Supabase
-- auth trigger) or lazily on first project write, whichever B-2 finds
-- simpler". A trigger is simpler here: it makes the invariant ("every user
-- has exactly one personal org") hold unconditionally at the database level,
-- rather than requiring every code path that can create a user to remember
-- to also create their org.
CREATE FUNCTION app.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = app, pg_catalog
AS $$
BEGIN
  INSERT INTO app.user_profile (user_id) VALUES (NEW.id);
  INSERT INTO app.organization (owner_user_id, name, is_personal)
    VALUES (NEW.id, 'Personal', true);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app.handle_new_user();

CREATE TABLE app.project (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id            uuid NOT NULL REFERENCES app.organization(id) ON DELETE CASCADE,
  name              text NOT NULL,
  status            app.project_status NOT NULL DEFAULT 'draft',
  business_type_id  bigint REFERENCES content.business_type(id),
  jurisdiction_id   bigint REFERENCES content.jurisdiction(id),
  reporting_currency content.currency_code NOT NULL DEFAULT 'DOP',
  fx_usd_dop        numeric(12,6),
  fx_rate_as_of     date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_owner_ix ON app.project (owner_id, updated_at DESC);
CREATE INDEX project_org_ix ON app.project (org_id, updated_at DESC);

CREATE TABLE app.project_location (
  project_id      uuid PRIMARY KEY REFERENCES app.project(id) ON DELETE CASCADE,
  geom            geometry(Polygon, 4326),          -- confirmed or drawn outline
  centroid        geometry(Point, 4326) NOT NULL,
  address_text    text,
  admin_area_id   bigint REFERENCES geo.admin_area(id),
  suggested_footprint_id bigint REFERENCES geo.building_footprint(id),
  suggested_area_sqm     numeric(12,2),
  area_sqm        numeric(12,2) CHECK (area_sqm > 0),
  area_source     app.area_source NOT NULL,
  area_confirmed_at timestamptz,
  coverage_tier   content.confidence_tier NOT NULL DEFAULT 'insuficiente',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (area_confirmed_at IS NULL OR area_sqm IS NOT NULL)
);
CREATE INDEX project_location_centroid_gix ON app.project_location USING gist (centroid);

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
  default_parameter_value_id bigint REFERENCES content.parameter_value(id),
  is_overridden   boolean NOT NULL DEFAULT false,
  implausible_flag boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, key),
  CHECK (value_low <= value_base AND value_base <= value_high)
);

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
  results_json    jsonb NOT NULL,
  monthly_low_amount  content.money_amount NOT NULL,
  monthly_base_amount content.money_amount NOT NULL,
  monthly_high_amount content.money_amount NOT NULL,
  currency            content.currency_code NOT NULL,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (monthly_low_amount <= monthly_base_amount AND monthly_base_amount <= monthly_high_amount)
);

CREATE TABLE app.financial_projection (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
  engine_version  text NOT NULL,
  rule_pack_ids   bigint[] NOT NULL DEFAULT '{}',
  as_of_date      date NOT NULL,
  fx_usd_dop      numeric(12,6),
  inputs_snapshot jsonb NOT NULL,
  results_json    jsonb NOT NULL,          -- monthly series, P&L, cash flow, sensitivity
  breakeven_month_low  smallint,
  breakeven_month_base smallint,
  breakeven_month_high smallint,
  currency        content.currency_code NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX financial_projection_project_ix ON app.financial_projection (project_id, computed_at DESC);

CREATE TABLE app.market_study (
  project_id        uuid PRIMARY KEY REFERENCES app.project(id) ON DELETE CASCADE,
  engine_version    text NOT NULL,
  radius_m          integer NOT NULL,
  population_est    integer NOT NULL,
  competitor_count  integer NOT NULL,
  competitors_user_added integer NOT NULL DEFAULT 0,
  demand_index_low  numeric(10,4), demand_index_base numeric(10,4), demand_index_high numeric(10,4),
  confidence        content.confidence_tier NOT NULL,
  census_year       smallint NOT NULL,
  poi_vintage       date,
  computed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.permit_checklist_item (
  id              bigserial PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
  rule_id         bigint REFERENCES content.rule(id),
  rule_pack_id    bigint NOT NULL REFERENCES content.rule_pack(id),
  title_es        text NOT NULL,
  agency_name     text,
  requirement     content.permit_requirement NOT NULL,
  citation_id     bigint NOT NULL REFERENCES content.citation(id),
  user_marked_done boolean NOT NULL DEFAULT false,
  display_order   integer NOT NULL DEFAULT 0,
  generated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX permit_checklist_project_ix ON app.permit_checklist_item (project_id, display_order);

CREATE TABLE app.report (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
  requested_by         uuid NOT NULL REFERENCES auth.users(id),
  tier                 app.report_tier NOT NULL DEFAULT 'resumen_analisis',
  status               app.report_status NOT NULL DEFAULT 'queued',
  financial_projection_id uuid REFERENCES app.financial_projection(id),
  engine_version       text,
  disclaimer_document_id bigint REFERENCES app.legal_document(id),
  storage_key          text,
  failure_reason       text,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  CHECK (status <> 'ready' OR (storage_key IS NOT NULL AND disclaimer_document_id IS NOT NULL))
);


-- =====================================================================
-- 7. ROW-LEVEL SECURITY
-- =====================================================================

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

CREATE POLICY own_profile ON app.user_profile
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY own_organization ON app.organization
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY own_legal_acceptance ON app.legal_acceptance
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY own_consent ON app.consent
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY own_project ON app.project
  USING (owner_id = auth.uid() AND org_id IN (SELECT app.current_org_ids()))
  WITH CHECK (owner_id = auth.uid() AND org_id IN (SELECT app.current_org_ids()));

-- Child tables inherit both scopes through the project. Written once per table
-- because Postgres has no policy inheritance; the EXISTS form lets the planner
-- use project_owner_ix / project_org_ix. specs/db/schema.sql left this
-- generation step to B-2 rather than hand-repeating it in the spec.
CREATE POLICY own_project_child ON app.project_location
  USING (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = project_location.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = project_location.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())));

CREATE POLICY own_project_child ON app.project_assumption
  USING (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = project_assumption.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = project_assumption.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())));

CREATE POLICY own_project_child ON app.capacity_estimate
  USING (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = capacity_estimate.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = capacity_estimate.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())));

CREATE POLICY own_project_child ON app.fitout_estimate
  USING (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = fitout_estimate.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = fitout_estimate.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())));

CREATE POLICY own_project_child ON app.opex_estimate
  USING (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = opex_estimate.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = opex_estimate.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())));

CREATE POLICY own_project_child ON app.financial_projection
  USING (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = financial_projection.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = financial_projection.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())));

CREATE POLICY own_project_child ON app.market_study
  USING (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = market_study.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = market_study.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())));

CREATE POLICY own_project_child ON app.permit_checklist_item
  USING (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = permit_checklist_item.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = permit_checklist_item.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())));

CREATE POLICY own_project_child ON app.report
  USING (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = report.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM app.project p
                 WHERE p.id = report.project_id
                   AND p.owner_id = auth.uid()
                   AND p.org_id IN (SELECT app.current_org_ids())));

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

-- =====================================================================
-- Local-equivalent grants (not in specs/db/schema.sql): Supabase grants its
-- `authenticated` role broad access to user-owned schemas by default and lets
-- RLS do the row-level scoping; on local Postgres those grants must be made
-- explicitly, or every query as `authenticated` fails on privilege alone
-- before RLS is ever evaluated.
-- =====================================================================
GRANT USAGE ON SCHEMA app TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO authenticated;
GRANT EXECUTE ON FUNCTION app.current_org_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;


-- Down Migration

DROP SCHEMA IF EXISTS app CASCADE;
DROP SCHEMA IF EXISTS content CASCADE;
DROP SCHEMA IF EXISTS ephemeral CASCADE;
DROP SCHEMA IF EXISTS geo CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    DROP ROLE authenticated;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    DROP ROLE service_role;
  END IF;
END
$$;
