-- Up Migration
-- =====================================================================
-- SODEJA — B-5: add geo.poi_place.confidence
--
-- The ONE sanctioned change to the approved schema since it was written
-- (specs/db/schema.sql), justified by information that did not exist when
-- that spec was authored: the P0-1 Overture Places DR coverage spike
-- (docs/SODEJA_DATA_SOURCES.md, 2026-07-31) measured that a majority of DR
-- Overture Places records sit below 0.7 confidence and explicitly
-- recommended keeping `confidence` first-class and queryable rather than
-- discarding it or low-confidence rows at ingestion time — that recommended
-- filtering is a downstream, query-time concern (B-9 coverage-tier
-- suppression, M1/M8 competitor counting), not something B-5's ingestion
-- job bakes in as a silent exclusion.
--
-- Mirrors geo.building_footprint.confidence exactly (same numeric(4,3),
-- same CHECK, same nullability rationale: not every source reports it).
-- specs/db/schema.sql has been updated in place to keep the spec and this
-- migration in agreement; this migration is what actually applies the
-- change.
-- =====================================================================

ALTER TABLE geo.poi_place
  ADD COLUMN confidence numeric(4,3) CHECK (confidence BETWEEN 0 AND 1);


-- Down Migration

ALTER TABLE geo.poi_place
  DROP COLUMN IF EXISTS confidence;
