import { normalizeError, ProviderError } from "./errors.js";

/**
 * Races `fn` against a timer rather than only awaiting it: neither
 * TileProvider nor GeocodingProvider's interface accepts (or is required to
 * honor) an AbortSignal, so a callee that simply never settles must not hang
 * this wrapper forever. `fn` still receives the signal — a real fetch-based
 * adapter can pass it straight to `fetch(url, { signal })` to actually cancel
 * the in-flight request — but withTimeout no longer depends on that
 * cooperation to return on time.
 */
export async function withTimeout<T>(
  provider: string,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let timer!: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(
        new ProviderError({
          code: "TIMEOUT",
          provider,
          message: `${provider} request exceeded ${timeoutMs}ms`,
        }),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      throw new ProviderError({
        code: "TIMEOUT",
        provider,
        message: `${provider} request exceeded ${timeoutMs}ms`,
        cause: error,
      });
    }
    throw normalizeError(provider, error);
  } finally {
    clearTimeout(timer);
  }
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  /** Injectable so tests run deterministically without real waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable so tests can assert exact, non-random delays. */
  jitter?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retries only ProviderError.retryable failures (TIMEOUT, UPSTREAM_ERROR).
 * RATE_LIMITED and CIRCUIT_OPEN are deliberately never retried here — retrying
 * past a rate limiter or an open circuit would defeat the point of both.
 */
export async function withRetry<T>(
  provider: string,
  options: RetryOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const jitter = options.jitter ?? Math.random;
  let lastError: ProviderError | undefined;

  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const normalized = normalizeError(provider, error);
      lastError = normalized;
      const isLastAttempt = attempt === options.maxAttempts - 1;
      if (!normalized.retryable || isLastAttempt) {
        throw normalized;
      }
      const backoff = options.baseDelayMs * 2 ** attempt;
      await sleep(backoff + jitter() * options.baseDelayMs);
    }
  }

  // Unreachable when maxAttempts >= 1, kept for type completeness.
  throw lastError ?? new ProviderError({ code: "UNKNOWN", provider, message: "Retry exhausted" });
}

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  now?: () => number;
}

/**
 * Per-provider circuit breaker. CLOSED allows calls and counts consecutive
 * failures; hitting failureThreshold trips to OPEN, which rejects immediately
 * without invoking the wrapped function (protects an already-struggling
 * upstream from further load, and gives callers a fast, cheap failure instead
 * of another timeout). After resetTimeoutMs, one trial call is allowed
 * (HALF_OPEN); success closes the circuit, failure re-opens it.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly now: () => number;

  constructor(
    private readonly provider: string,
    private readonly options: CircuitBreakerOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitState {
    if (this.state === "open" && this.now() - this.openedAt >= this.options.resetTimeoutMs) {
      return "half_open";
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const effectiveState = this.getState();
    if (effectiveState === "open") {
      throw new ProviderError({
        code: "CIRCUIT_OPEN",
        provider: this.provider,
        message: `${this.provider} circuit is open; failing fast`,
      });
    }
    if (effectiveState === "half_open") {
      // Persist the transition so onSuccess/onFailure see it: getState() is a
      // pure derivation and must not have side effects on its own.
      this.state = "half_open";
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw normalizeError(this.provider, error);
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.state === "half_open" || this.consecutiveFailures >= this.options.failureThreshold) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }
}
