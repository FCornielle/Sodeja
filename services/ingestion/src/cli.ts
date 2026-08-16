#!/usr/bin/env node
import { createLogger } from "@sodeja/observability";
import { closePool } from "@sodeja/db";
import { runComputeDataCoverageJob } from "./jobs/computeDataCoverage.js";
import { runComputePopulationGridJob } from "./jobs/computePopulationGrid.js";
import { runIngestAdminAreasJob } from "./jobs/ingestAdminAreas.js";
import { runIngestBuildingFootprintsJob } from "./jobs/ingestBuildingFootprints.js";
import { runIngestCensusPopulationJob } from "./jobs/ingestCensusPopulation.js";
import { runIngestPoiPlacesJob } from "./jobs/ingestPoiPlaces.js";

const JOBS: Record<string, (logger: ReturnType<typeof createLogger>) => Promise<void>> = {
  "admin-areas": runIngestAdminAreasJob,
  footprints: runIngestBuildingFootprintsJob,
  census: runIngestCensusPopulationJob,
  poi: runIngestPoiPlacesJob,
  "data-coverage": runComputeDataCoverageJob,
  "population-grid": runComputePopulationGridJob,
};

async function main(): Promise<void> {
  const jobName = process.argv[2];
  const job = jobName ? JOBS[jobName] : undefined;
  if (!job) {
    process.stderr.write(`Usage: node cli.js <${Object.keys(JOBS).join("|")}>\n`);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger(`ingestion:${jobName}`);
  try {
    await job(logger);
  } catch (error) {
    logger.error({ err: error }, `ingestion job "${jobName}" failed`);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
