# `apps/mobile` — SODEJA Android Application

**Status: placeholder. No implementation, no dependencies installed.**

Phase 1 ships a **thin, online-capable companion** — not a full offline client.
The field scenario (standing at a commercial space, running numbers on the spot)
is real, but the full offline stack is Phase 2 (B-27), because maps are the part
that most needs connectivity and the part most expensive to make offline.

## Intended stack

| Concern | Choice |
|---|---|
| Framework | React Native + Expo (EAS Build / EAS Update) |
| Map | MapLibre Native; OSM PMTiles, no satellite layer (see `apps/web`) |
| Local store | Expo SQLite (Phase 2; Phase 1 caches saved analyses only) |
| Calculations | `@sodeja/calc` — the same TypeScript artifact the web app runs |

## Why React Native rather than native Kotlin or Flutter

`@sodeja/calc` must produce byte-identical results on web, on device, and in the
exported PDF. Users may take these numbers to a bank. A split-language stack
forces either a ported engine (two sources of truth for the same figures) or an
online-only app. TypeScript everywhere avoids both.

**This remains an open decision** — if the team's existing skill is Dart,
Flutter is defensible, but budget a Dart port of the engine behind a shared
conformance test suite in CI (Master Plan §4.3).

## Phase 1 vs Phase 2 scope

| Capability | Phase 1 | Phase 2 |
|---|---|---|
| View + edit saved analyses offline | Yes | Yes |
| Run `@sodeja/calc` on device | Yes | Yes |
| Map browsing / building selection | Online required | DR-wide PMTiles pack |
| Mutation sync | Online required | Idempotent outbox queue |
| Conflict handling | n/a | Last-write-wins per project (no CRDTs) |

## Boundaries

- **No API keys in the APK** (risk T7). Provider access is server-proxied.
- Degradation must state a reason. "Necesita conexión para buscar negocios
  cercanos" — never a silent empty state.
- Data-cost hygiene: explicit download toggles with sizes shown, Wi-Fi-only
  default for large downloads. Prepaid metered data is the norm in the DR market.

## Related backlog items

B-21 (Android shell), B-27 (full offline).
