# `@sodeja/schemas` — Shared Contract Definitions

**Status: placeholder. No implementation.**

One definition of every boundary type, consumed by the web app, the Android app,
the API, and the PDF worker. Zod schemas are the source of truth; TypeScript
types are inferred from them, never hand-written alongside them.

## What lives here

- **Primitives** — `Money`, `MoneyRange`, `NumericRange`, `Provenance`,
  `Citation`, `DataConfidence`. These recur in nearly every payload; defining
  them once is what keeps the range-and-provenance posture from eroding.
- **Domain entities** — project, location, assumption, capacity estimate,
  cost estimate, financial projection, permit checklist item, report.
- **API request/response shapes** — mirroring
  [`specs/api/openapi.yaml`](../../specs/api/openapi.yaml).
- **Engine I/O contracts** — the input and output shapes of `@sodeja/calc`,
  versioned alongside the engine.

## Why Zod rather than OpenAPI-generated types alone

The OpenAPI document is the external contract; these schemas are the *runtime*
contract. The API validates inbound payloads with the same object the client
used to build them, which removes an entire class of drift. Where the two must
agree, CI checks the OpenAPI document against these schemas rather than
trusting a convention.

## Boundaries

- **No business logic.** Validation and shape only. Formulas live in
  `@sodeja/calc`; rule evaluation lives in `@sodeja/rules`.
- **No rate constants.** A schema may constrain that a tax rate is a number
  between 0 and 1; it must never state which number.
- **Additive evolution.** Payload shapes are versioned; a released shape is not
  mutated, because Android clients update on their own schedule.

## Related backlog items

B-1 (monorepo, CI, schemas, error monitoring).
