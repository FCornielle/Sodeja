import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import type { GeocodingProvider, GeocodingResult, HealthCheckResult } from "@sodeja/providers";
import { ProviderError } from "@sodeja/providers";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderErrorFilter } from "./provider-error.filter.js";
import { ProvidersModule } from "./providers.module.js";
import { GEOCODING_PROVIDER } from "./tokens.js";

class SlowGeocodingProvider implements GeocodingProvider {
  readonly name = "slow-test-double";

  async geocode(): Promise<GeocodingResult[]> {
    return new Promise(() => {
      // Never settles: exercises withTimeout against a non-cooperating callee.
    });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { provider: this.name, status: "ok" };
  }
}

class FlakyGeocodingProvider implements GeocodingProvider {
  readonly name = "flaky-test-double";
  callCount = 0;

  async geocode(): Promise<GeocodingResult[]> {
    this.callCount += 1;
    throw new ProviderError({
      code: "UPSTREAM_ERROR",
      provider: this.name,
      message: "simulated upstream failure",
    });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { provider: this.name, status: "down" };
  }
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    original[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(original)) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function createTestApp(
  envOverrides: Record<string, string | undefined>,
  overrideModule?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplication> {
  return withEnv(envOverrides, async () => {
    let builder = Test.createTestingModule({ imports: [ProvidersModule] });
    if (overrideModule) {
      builder = overrideModule(builder);
    }
    const moduleRef = await builder.compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ProviderErrorFilter());
    await app.init();
    return app;
  });
}

let app: INestApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("provider switching via env", () => {
  it("uses the mock tile provider when TILE_PROVIDER=mock", async () => {
    app = await createTestApp({ TILE_PROVIDER: "mock", GEOCODING_PROVIDER: "mock", POI_PROVIDER: "mock" });

    const res = await request(app.getHttpServer()).get("/providers/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: "mock-tiles", status: "ok" })]),
    );
  });

  it("switches to the google tile adapter (reported unconfigured, no live call) when TILE_PROVIDER=google", async () => {
    app = await createTestApp({
      TILE_PROVIDER: "google",
      GEOCODING_PROVIDER: "mock",
      POI_PROVIDER: "mock",
      GOOGLE_MAPS_API_KEY: undefined,
    });

    const res = await request(app.getHttpServer()).get("/providers/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "google-tiles", status: "unconfigured" }),
      ]),
    );
  });
});

describe("rate limiting", () => {
  it("returns 429 with a safe error body once the per-IP limit is exceeded", async () => {
    app = await createTestApp({
      GEOCODING_PROVIDER: "mock",
      RATE_LIMIT_PER_IP_PER_MIN: "2",
      RATE_LIMIT_PER_USER_PER_MIN: "1000",
    });
    const server = app.getHttpServer();

    await request(server).get("/providers/geocode?query=a").expect(200);
    await request(server).get("/providers/geocode?query=b").expect(200);
    const res = await request(server).get("/providers/geocode?query=c");

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      code: "RATE_LIMITED",
      provider: "providers-proxy",
      message: expect.any(String),
      retryable: false,
    });
  });

  it("enforces the per-user limit independently of the per-IP limit", async () => {
    app = await createTestApp({
      GEOCODING_PROVIDER: "mock",
      RATE_LIMIT_PER_USER_PER_MIN: "1",
      RATE_LIMIT_PER_IP_PER_MIN: "1000",
    });
    const server = app.getHttpServer();

    await request(server).get("/providers/geocode?query=a").set("x-user-id", "u1").expect(200);
    const res = await request(server).get("/providers/geocode?query=b").set("x-user-id", "u1");

    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/user/);
  });
});

describe("timeout behavior", () => {
  it("returns 504 TIMEOUT when the provider never responds", async () => {
    app = await createTestApp(
      { PROVIDER_TIMEOUT_MS: "30", PROVIDER_RETRY_MAX_ATTEMPTS: "1" },
      (builder) => builder.overrideProvider(GEOCODING_PROVIDER).useValue(new SlowGeocodingProvider()),
    );

    const res = await request(app.getHttpServer()).get("/providers/geocode?query=x");

    expect(res.status).toBe(504);
    expect(res.body).toEqual({
      code: "TIMEOUT",
      provider: "slow-test-double",
      message: expect.any(String),
      retryable: true,
    });
  });
});

describe("circuit breaker", () => {
  it("opens after the failure threshold and fails fast without calling the provider again", async () => {
    const flaky = new FlakyGeocodingProvider();
    app = await createTestApp(
      { PROVIDER_CIRCUIT_FAILURE_THRESHOLD: "1", PROVIDER_RETRY_MAX_ATTEMPTS: "1" },
      (builder) => builder.overrideProvider(GEOCODING_PROVIDER).useValue(flaky),
    );
    const server = app.getHttpServer();

    const first = await request(server).get("/providers/geocode?query=x");
    expect(first.status).toBe(502);
    expect(first.body.code).toBe("UPSTREAM_ERROR");

    const second = await request(server).get("/providers/geocode?query=x");
    expect(second.status).toBe(503);
    expect(second.body.code).toBe("CIRCUIT_OPEN");

    // The circuit failed fast on the second call: the double was never invoked again.
    expect(flaky.callCount).toBe(1);
  });
});

describe("error normalization", () => {
  it("always responds with the ProviderError.toSafeJSON shape, never a raw stack trace", async () => {
    app = await createTestApp(
      { PROVIDER_TIMEOUT_MS: "30", PROVIDER_RETRY_MAX_ATTEMPTS: "1" },
      (builder) => builder.overrideProvider(GEOCODING_PROVIDER).useValue(new SlowGeocodingProvider()),
    );

    const res = await request(app.getHttpServer()).get("/providers/geocode?query=x");

    expect(Object.keys(res.body).sort()).toEqual(["code", "message", "provider", "retryable"]);
  });
});

describe("secret isolation", () => {
  it("never leaks a configured API key even when the upstream error message contains it", async () => {
    const secret = "test-secret-value-should-never-leak";
    // GoogleGeocodingProvider reads its API key lazily, per call, so the env
    // var must stay set for the whole test, not just app construction — hence
    // vi.stubEnv (cleared in afterEach) rather than createTestApp's
    // construction-only env scoping used elsewhere in this file.
    vi.stubEnv("GEOCODING_PROVIDER", "google");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", secret);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(
        new Error(
          `request to https://maps.googleapis.com/maps/api/geocode/json?address=x&key=${secret} failed`,
        ),
      );

    app = await createTestApp({});

    const res = await request(app.getHttpServer()).get("/providers/geocode?query=x");

    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(res.text).not.toContain(secret);
    expect(fetchSpy).toHaveBeenCalled();
  });
});
