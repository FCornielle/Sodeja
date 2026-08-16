/**
 * DI tokens for B-19's render pipeline, mirroring
 * apps/api/src/providers/tokens.ts's pattern: injecting `@sodeja/pdf-worker`'s
 * queue and storage adapters by token (rather than `ReportsService`
 * constructing them itself) lets a test substitute a controllable double —
 * e.g. a queue that awaits its job inline instead of relying on the real
 * in-memory queue's async timing, or a storage double that never touches
 * disk — via `overrideProvider(REPORT_QUEUE).useValue(...)`.
 */
export const REPORT_QUEUE = Symbol("REPORT_QUEUE");
export const REPORT_STORAGE = Symbol("REPORT_STORAGE");
