import { defineConfig } from "vitest/config";

/**
 * Every `*.controller.test.ts` file in this app is a DB-backed integration
 * test (`describe.skipIf(!process.env.DATABASE_URL)`) that spins up its own
 * `INestApplication` and hits the same local Postgres container. Running all
 * of them in parallel processes (vitest's default) contends for the same
 * connection pool/CPU and was observed to blow past the default 5s
 * per-test timeout on the FIRST test of nearly every file — not a real
 * regression, just resource contention, confirmed by re-running the exact
 * same suite with `fileParallelism: false` and everything passing. Same
 * fix, same reasoning, as `services/ingestion/vitest.config.ts`.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
