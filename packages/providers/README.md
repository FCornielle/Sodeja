# `@sodeja/providers` — Provider Abstraction, Resilience & Metering

The library half of B-3. Every external map/POI/geocoding provider sits
behind an adapter (`TileProvider`, `GeocodingProvider`, `PoiProvider` in
`types.ts`); `apps/api`'s `providers` module is the only code allowed to
instantiate one directly (see `apps/api/README.md`).

## What lives here

- **Adapters** (`adapters/`) — `Mock*` (deterministic, no network, the dev/test
  default), `LocalDirectoryTileProvider` (`pmtiles-local`, reads static tiles
  from disk once B-4 produces them), `OvertureLocalPoiProvider`
  (`overture-local`, reports `unconfigured` until B-5 wires the DB query),
  and the credentialed adapters — `HttpTileProvider` (parameterized for
  Google/Mapbox/MapTiler), `GoogleGeocodingProvider`, `GooglePlacesProvider`.
  **None of the credentialed adapters ever call `fetch` without their API-key
  env var present** — they throw `NOT_CONFIGURED` instead, and their
  `healthCheck()` never makes a network call either.
- **`registry.ts`** — `createTileProvider()` / `createGeocodingProvider()` /
  `createPoiProvider()` read `TILE_PROVIDER` / `GEOCODING_PROVIDER` /
  `POI_PROVIDER` and return the matching adapter. Switching a provider is
  always a config change here.
- **`resilience.ts`** — `withTimeout`, `withRetry` (exponential backoff,
  retries only `TIMEOUT`/`UPSTREAM_ERROR`, never `RATE_LIMITED`/
  `CIRCUIT_OPEN`), and `CircuitBreaker` (closed → open → half-open).
- **`rateLimiter.ts`** — `DualRateLimiter` enforces a per-user **and** a
  per-IP `RateLimiter` independently; either tripping rejects the call.
- **`usageMeter.ts` / `costEstimator.ts` / `billingAlerts.ts`** — in-memory
  call counters, an internal cost estimate against a configured per-call rate
  (using `@sodeja/schemas`'s `Money`), and threshold checks that log via
  `@sodeja/observability`. **No cloud billing API is ever called** — this is
  local arithmetic and logging only (risk F1).
- **`errors.ts`** — `ProviderError` with a `toSafeJSON()` that deliberately
  omits `cause`: a raw upstream error can carry a request URL with an
  embedded API key, so nothing may cross the proxy boundary except the safe
  shape.

## Usage (see `apps/api`'s providers module for the full proxy wiring)

```ts
import { createTileProvider, CircuitBreaker, withRetry, withTimeout } from "@sodeja/providers";

const tiles = createTileProvider(); // reads TILE_PROVIDER
const breaker = new CircuitBreaker(tiles.name, { failureThreshold: 5, resetTimeoutMs: 30_000 });

const tile = await breaker.execute(() =>
  withRetry(tiles.name, { maxAttempts: 3, baseDelayMs: 200 }, () =>
    withTimeout(tiles.name, 5000, () => tiles.getTile(z, x, y)),
  ),
);
```

## Related backlog items

B-3 (provider abstraction, server-side proxy, rate caps, billing alerts).
