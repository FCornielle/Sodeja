# `services/pdf-worker` — Report Rendering Service

**Status: implemented (B-19), as a LIBRARY `apps/api`'s `reports` module
imports (`@sodeja/pdf-worker`) — not yet the separate deployable process
this document describes below.** No Redis/queue infrastructure is
provisioned anywhere in this codebase, so B-19 dispatches the render job
in-process via an in-memory queue (`src/queue.ts`) rather than standing up
a second process talking to a broker. See `apps/api/README.md`'s "B-19
contract" section for the full write-up (what is hard-blocking vs.
gracefully degraded, the queue's known limitations, and what a real
BullMQ+Redis + separate-process migration would need to change) and this
package's own `src/` files for the pure rendering pipeline (React SSR via
`react-dom/server` -> Playwright -> PDF), the filesystem storage driver
(`src/storage.ts`), and the queue (`src/queue.ts`) — each documents in its
own header exactly which parts of the diagram below it does NOT yet
implement.

Carved out of the monolith **from day one**. Chromium is memory-hungry and slow
to start; sharing a process with the API means one large report degrades every
request. Report generation is also the one operation users tolerate waiting for.

## Shape

```
API  ──enqueue──►  Redis (BullMQ)  ──►  pdf-worker
                                          │  render React template → HTML
                                          │  Playwright → PDF
                                          ▼
                                    Object storage
                                          │
                                    signed URL ──► notify user
```

Always asynchronous. `POST /projects/{id}/reports` returns `202` with a report
id; the client polls or receives a notification. The request path never blocks
on Chromium.

**Storage and queue are free/local by default** (product decision 2026-07-25):
`STORAGE_DRIVER=filesystem` and a local Redis or in-memory queue. GCS is
permitted only within the existing $300 GCP credit balance. Signed-URL issuance
is part of the storage interface, so the `downloadUrl` contract is identical
across drivers. No paid storage plan without product-owner approval.

**B-19's actual implementation of this**: the filesystem driver
(`src/storage.ts`) does NOT issue a real signed URL — there is no separate
object-storage service to mint one against for a plain local directory.
`GET /projects/:id/reports/:reportId/download` is a direct, authenticated
download instead (protected by the same ownership check as every other
project route), documented explicitly in `storage.ts`'s header as a
simplification appropriate to local/free storage, not a substitute
security feature. A future `STORAGE_DRIVER=gcs` driver would need genuine
signed-URL issuance behind the same `ReportStorage` interface (`src/types.ts`).

## Why Chromium rather than a PDF DSL

Full CSS control, real chart rendering, and correct Spanish typography without
fighting a layout API. The report template is React, so it reuses the same
presentation components — and the same `@sodeja/calc` outputs — as the screen.

## Mandatory content on every export

These are compliance requirements, not formatting preferences (risks L1, L7):

- Non-dismissible disclaimer: user-supplied and model-generated, **unaudited**.
- `engine_version` and `rule_pack_version` that produced the figures.
- Generation timestamp and the `asOfDate` of all rates used.
- An assumptions appendix listing every input with its provenance tag
  (`usuario` / `referencia_sectorial` / `estimado`).
- Ranges, never point estimates.
- Attribution for every map and data source rendered (ODbL obligations, risk L6).
- Watermark on the Phase 1 "Resumen de Análisis" tier, which is explicitly
  **not** the bank-facing business plan (that is Phase 2, B-26).

## Reproducibility

The worker regenerates from the stored `inputs_snapshot` and the pinned
`engine_version`, never from live data. A report re-exported months later is
byte-comparable to the original.

## Related backlog items

B-19 (PDF worker + Module 13 summary tier).
