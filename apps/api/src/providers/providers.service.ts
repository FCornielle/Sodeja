import { Inject, Injectable } from "@nestjs/common";
import {
  aggregateHealth,
  BillingAlertChecker,
  type BillingAlertResult,
  CircuitBreaker,
  CostEstimator,
  type GeocodingProvider,
  type GeocodingResult,
  type HealthCheckResult,
  type PoiProvider,
  type TileProvider,
  UsageMeter,
  withRetry,
  withTimeout,
} from "@sodeja/providers";
import { GEOCODING_PROVIDER, POI_PROVIDER, TILE_PROVIDER } from "./tokens.js";

/**
 * Singleton (Nest's default provider scope): the circuit breakers and usage
 * meter must persist across requests to mean anything. Adapters arrive via
 * DI token (see providers.module.ts / tokens.ts) rather than being
 * constructed here directly — this class never holds an API key itself, and
 * the indirection is what lets tests substitute a controllable double for
 * timeout/circuit-breaker scenarios.
 */
@Injectable()
export class ProvidersService {
  private readonly timeoutMs: number;
  private readonly retryMaxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly tileBreaker: CircuitBreaker;
  private readonly geocodingBreaker: CircuitBreaker;
  private readonly usageMeter = new UsageMeter();
  private readonly costEstimator: CostEstimator;
  private readonly billingAlertChecker: BillingAlertChecker;

  constructor(
    @Inject(TILE_PROVIDER) private readonly tileProvider: TileProvider,
    @Inject(GEOCODING_PROVIDER) private readonly geocodingProvider: GeocodingProvider,
    @Inject(POI_PROVIDER) private readonly poiProvider: PoiProvider,
  ) {
    this.timeoutMs = Number(process.env.PROVIDER_TIMEOUT_MS ?? 5000);
    this.retryMaxAttempts = Number(process.env.PROVIDER_RETRY_MAX_ATTEMPTS ?? 3);
    this.retryBaseDelayMs = Number(process.env.PROVIDER_RETRY_BASE_DELAY_MS ?? 200);

    const failureThreshold = Number(process.env.PROVIDER_CIRCUIT_FAILURE_THRESHOLD ?? 5);
    const resetTimeoutMs = Number(process.env.PROVIDER_CIRCUIT_RESET_TIMEOUT_MS ?? 30_000);
    this.tileBreaker = new CircuitBreaker(this.tileProvider.name, { failureThreshold, resetTimeoutMs });
    this.geocodingBreaker = new CircuitBreaker(this.geocodingProvider.name, {
      failureThreshold,
      resetTimeoutMs,
    });

    this.costEstimator = new CostEstimator([
      {
        provider: this.tileProvider.name,
        operation: "getTile",
        costPerCall: { amount: 0.005, currency: "USD" },
      },
      {
        provider: this.geocodingProvider.name,
        operation: "geocode",
        costPerCall: { amount: 0.005, currency: "USD" },
      },
    ]);

    this.billingAlertChecker = new BillingAlertChecker([
      {
        currency: "USD",
        warnAt: Number(process.env.BILLING_ALERT_WARN_USD ?? 10),
        criticalAt: Number(process.env.BILLING_ALERT_CRITICAL_USD ?? 50),
      },
    ]);
  }

  async getTile(z: number, x: number, y: number): Promise<Buffer> {
    return this.usageMeter.track(this.tileProvider.name, "getTile", () =>
      this.tileBreaker.execute(() =>
        withRetry(
          this.tileProvider.name,
          { maxAttempts: this.retryMaxAttempts, baseDelayMs: this.retryBaseDelayMs },
          () =>
            withTimeout(this.tileProvider.name, this.timeoutMs, () =>
              this.tileProvider.getTile(z, x, y),
            ),
        ),
      ),
    );
  }

  async geocode(query: string): Promise<GeocodingResult[]> {
    return this.usageMeter.track(this.geocodingProvider.name, "geocode", () =>
      this.geocodingBreaker.execute(() =>
        withRetry(
          this.geocodingProvider.name,
          { maxAttempts: this.retryMaxAttempts, baseDelayMs: this.retryBaseDelayMs },
          () =>
            withTimeout(this.geocodingProvider.name, this.timeoutMs, () =>
              this.geocodingProvider.geocode(query),
            ),
        ),
      ),
    );
  }

  async health(): Promise<HealthCheckResult[]> {
    return aggregateHealth([this.tileProvider, this.geocodingProvider, this.poiProvider]);
  }

  getBillingStatus(): BillingAlertResult[] {
    return this.billingAlertChecker.check(this.costEstimator.estimate(this.usageMeter.getUsage()));
  }
}
