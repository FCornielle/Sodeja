import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { BillingAlertResult, GeocodingResult, HealthCheckResult } from "@sodeja/providers";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { ProvidersService } from "./providers.service.js";

/**
 * The only controller allowed to reach a provider adapter — mirrors
 * apps/api/README.md: "The providers module is the only code that holds an
 * external API key." Every route that calls out to a provider is guarded by
 * RateLimitGuard; health/billing-status are read-only and unguarded since
 * they touch no external provider (health checks are config-only, never a
 * live network call — see @sodeja/providers's adapters).
 */
@Controller("providers")
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Get("health")
  async health(): Promise<HealthCheckResult[]> {
    return this.providersService.health();
  }

  @Get("billing-status")
  billingStatus(): BillingAlertResult[] {
    return this.providersService.getBillingStatus();
  }

  @UseGuards(RateLimitGuard)
  @Get("tiles/:z/:x/:y")
  async getTile(
    @Param("z", ParseIntPipe) z: number,
    @Param("x", ParseIntPipe) x: number,
    @Param("y", ParseIntPipe) y: number,
  ): Promise<Buffer> {
    return this.providersService.getTile(z, x, y);
  }

  @UseGuards(RateLimitGuard)
  @Get("geocode")
  async geocode(@Query("query") query: string): Promise<GeocodingResult[]> {
    if (!query) {
      throw new HttpException("query is required", HttpStatus.BAD_REQUEST);
    }
    return this.providersService.geocode(query);
  }
}
