import { defineConfig } from "vitest/config";

/**
 * The DB-integration test files (jobs/*.test.ts) share real geo.admin_area
 * rows (source = 'ocha_cod_ab') across files, each with its own
 * beforeAll/afterAll lifecycle that inserts then deletes them. Running test
 * files in parallel (vitest's default) would let one file's cleanup race
 * another file's fixture setup against the same rows, including FK
 * violations against geo.building_footprint / geo.census_population (no
 * ON DELETE CASCADE on those references — see specs/db/schema.sql).
 * fileParallelism: false makes files run one at a time, so each file's
 * lifecycle fully completes before the next begins. Only relevant when
 * DATABASE_URL is set; the pure unit tests are unaffected either way.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
