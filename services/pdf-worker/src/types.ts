import type {
  CapacityEstimate,
  Currency,
  FinancialProjection,
  FitoutEstimate,
  LayoutParameters,
  LegalDocument,
  MarketStudy,
  OpexEstimate,
  PermitChecklist,
  ProjectAssumption,
  ReportTier,
} from "@sodeja/schemas";

/**
 * A section of the report that either has real, stored data behind it, or
 * gracefully degrades to "no calculado aún" with a human-readable reason —
 * never a silently blank section, and never a fabricated figure standing in
 * for one that was never computed (docs/SODEJA_MVP_BACKLOG.md B-19 task
 * brief: "missing upstream estimates ... should render as a visibly
 * incomplete-but-honest report section"). See apps/api/src/reports/
 * reports.service.ts's `renderReportJob` for which sections can legitimately
 * be `available: false` and why (only `location` is a hard prerequisite;
 * every other section here is a graceful degrade).
 */
export type ReportSection<T> = { available: true; data: T } | { available: false; reason: string };

export interface ReportProjectSummary {
  name: string;
  businessTypeNameEs: string | null;
  jurisdictionName: string | null;
  reportingCurrency: Currency;
}

export interface ReportLocationSummary {
  areaSqm: number;
  /** `app.area_source` value as a string — 'footprint_dataset' | 'user_drawn' | 'user_entered'. */
  areaSource: string;
  areaConfirmedAt: string;
}

/**
 * Everything `renderReportPdf` needs to produce a complete PDF, gathered
 * entirely by `apps/api/src/reports/reports.service.ts` from already-stored
 * rows (or, for `layout`/`permits`, a live read through the owning module's
 * own service — see that file's header). This package never queries a
 * database itself; it is a pure rendering pipeline (React SSR -> Playwright
 * -> PDF), matching `@sodeja/calc`'s own "reads, never recomputes" posture
 * one level up the stack.
 */
export interface ReportRenderInput {
  reportId: string;
  tier: ReportTier;
  /** ISO datetime this render started — the "generation timestamp" the README's mandatory-content list requires. */
  generatedAt: string;
  /** `@sodeja/calc`'s `ENGINE_VERSION`, pinned at render time. */
  engineVersion: string;
  project: ReportProjectSummary;
  location: ReportLocationSummary;
  marketStudy: ReportSection<MarketStudy>;
  capacity: ReportSection<CapacityEstimate>;
  layout: ReportSection<LayoutParameters>;
  fitout: ReportSection<FitoutEstimate>;
  opex: ReportSection<OpexEstimate>;
  financialProjection: ReportSection<FinancialProjection>;
  permits: ReportSection<PermitChecklist>;
  /** Every `app.project_assumption` row for this project — the assumptions appendix, always present (possibly empty). */
  assumptions: ProjectAssumption[];
  /** The B-20 disclaimer, rendered in full — never just referenced (README "Mandatory content on every export"). */
  disclaimer: LegalDocument;
}

/**
 * A minimal, swappable job queue. `InMemoryReportQueue` (queue.ts) is the
 * only implementation this MVP slice ships; the interface exists so
 * apps/api/src/reports/reports.module.ts can inject it by DI token
 * (`REPORT_QUEUE`) the same way `providers.module.ts` injects adapters, and
 * so a test can substitute a synchronous double.
 */
export interface ReportQueue {
  enqueue(job: () => Promise<void>): void;
}

/**
 * A minimal, swappable object-storage interface. `FilesystemReportStorage`
 * (storage.ts) is the only implementation this MVP slice ships — see its
 * header for why "download" is a direct authenticated endpoint rather than
 * a real signed URL.
 */
export interface ReportStorage {
  save(key: string, data: Buffer): Promise<void>;
  /** `null` when the key does not exist — never throws for a missing file. */
  read(key: string): Promise<Buffer | null>;
}
