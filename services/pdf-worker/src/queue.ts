import { createLogger } from "@sodeja/observability";
import type { ReportQueue } from "./types.js";

const logger = createLogger("pdf-worker:queue");

/**
 * The B-19 task brief's "simple async dispatch within the same Node
 * process" — no Redis is provisioned anywhere in this codebase yet
 * (`CACHE_DRIVER` defaults to `memory`, matching apps/api/README.md's
 * free/local posture), so this is a genuine in-memory job queue rather than
 * a `services/pdf-worker` process talking to a real broker.
 *
 * FIFO, single-worker (jobs run ONE AT A TIME, never concurrently). This is
 * a deliberate simplification, not an oversight: Chromium is memory-hungry
 * (services/pdf-worker/README.md "Carved out of the monolith from day
 * one" — "one large report degrades every request"), and this queue lives
 * IN the same process as the rest of apps/api, so bounding concurrency to
 * one render at a time is the cheapest available protection against a burst
 * of report requests starving the API of memory/CPU.
 *
 * KNOWN LIMITATIONS of this MVP slice, and what a real BullMQ+Redis
 * migration would need to change:
 *   - No persistence. A process restart mid-render silently loses every
 *     queued and in-flight job; the `app.report` row is left at
 *     `status='rendering'` or `'queued'` forever (no reaper exists for
 *     this). BullMQ+Redis would persist the job and let a worker resume or
 *     retry it after a restart.
 *   - No retries. A job that throws is caught by the caller
 *     (apps/api/src/reports/reports.service.ts's `renderReportJob` already
 *     catches its own errors and marks the report `'failed'`), but there is
 *     no automatic re-attempt. BullMQ exposes configurable retry/backoff
 *     policies per job.
 *   - No cross-process fan-out. Every job runs in the SAME Node process
 *     that received the `POST /projects/:id/reports` request — this is
 *     `services/pdf-worker` as a LIBRARY, not `services/pdf-worker` as the
 *     separate deployable the README describes. Moving to a real worker
 *     process means this queue's `enqueue()` becomes "publish to Redis" and
 *     a genuinely separate `services/pdf-worker` process becomes the
 *     consumer — the `ReportQueue` interface (types.ts) is shaped so that
 *     swap only touches this file and reports.module.ts's provider wiring.
 */
export class InMemoryReportQueue implements ReportQueue {
  private readonly pending: Array<() => Promise<void>> = [];
  private draining = false;

  enqueue(job: () => Promise<void>): void {
    this.pending.push(job);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let next = this.pending.shift();
      while (next) {
        try {
          await next();
        } catch (error) {
          // Last-resort guard: every real job (reports.service.ts's
          // renderReportJob) already catches its own errors and marks the
          // report 'failed', so reaching here means a job broke that
          // contract. Logged, never rethrown — one bad job must not stop
          // the queue from draining the rest.
          logger.error({ err: error }, "report queue job threw past its own error handling");
        }
        next = this.pending.shift();
      }
    } finally {
      this.draining = false;
    }
  }
}
