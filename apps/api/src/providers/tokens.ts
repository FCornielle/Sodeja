/**
 * DI tokens for the env-selected adapters. Injecting by token (rather than
 * ProvidersService calling createTileProvider() etc. itself) is what lets
 * integration tests swap in a controllable test double via
 * `overrideProvider(TILE_PROVIDER).useValue(...)` to exercise timeout/retry/
 * circuit-breaker behavior deterministically.
 */
export const TILE_PROVIDER = Symbol("TILE_PROVIDER");
export const GEOCODING_PROVIDER = Symbol("GEOCODING_PROVIDER");
export const POI_PROVIDER = Symbol("POI_PROVIDER");
