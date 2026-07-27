# `@sodeja/observability` — Structured Logging & Telemetry Seam

`createLogger(name)` returns a [pino](https://getpino.io) logger writing
structured JSON to stdout. This is the `TELEMETRY_DRIVER` seam that
[`apps/api/README.md`](../../apps/api/README.md) documents in its provider
table, with `stdout-json` as the only driver implemented in Phase 1
(free/local-first infra decision, [`SODEJA_ARCHITECTURE.md`](../../docs/SODEJA_ARCHITECTURE.md)).

A paid error-tracking backend (Sentry or equivalent) is a Phase 2+ addition
behind this same interface — swapping `TELEMETRY_DRIVER` is a config change,
never a rewrite, and requires explicit product-owner approval before any
billing-incurring provider is wired in.

## Usage

```ts
import { createLogger } from "@sodeja/observability";

const logger = createLogger("api");
logger.info({ projectId }, "project created");
```

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `TELEMETRY_DRIVER` | `stdout-json` | Only supported value in Phase 1; any other value throws at logger-creation time. |
| `LOG_LEVEL` | `info` | Standard pino levels. |

## Related backlog items

B-1 (monorepo, CI, schemas, error monitoring).
