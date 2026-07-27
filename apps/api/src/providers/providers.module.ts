import { Module } from "@nestjs/common";
import { createGeocodingProvider, createPoiProvider, createTileProvider } from "@sodeja/providers";
import { ProvidersController } from "./providers.controller.js";
import { ProvidersService } from "./providers.service.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { GEOCODING_PROVIDER, POI_PROVIDER, TILE_PROVIDER } from "./tokens.js";

@Module({
  controllers: [ProvidersController],
  providers: [
    ProvidersService,
    RateLimitGuard,
    // useFactory (not useValue) so TILE_PROVIDER/GEOCODING_PROVIDER/POI_PROVIDER
    // env vars are read at module-compile time, not at this file's import time.
    { provide: TILE_PROVIDER, useFactory: () => createTileProvider() },
    { provide: GEOCODING_PROVIDER, useFactory: () => createGeocodingProvider() },
    { provide: POI_PROVIDER, useFactory: () => createPoiProvider() },
  ],
})
export class ProvidersModule {}
