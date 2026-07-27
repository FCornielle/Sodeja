# `services/pdf-worker` — Report Rendering Service

**Status: placeholder. No implementation.**

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
