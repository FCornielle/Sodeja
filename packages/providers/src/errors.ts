/**
 * Every failure mode a provider adapter can produce, normalized to one shape.
 * The `cause` field is intentionally excluded from JSON.stringify/toJSON: raw
 * upstream errors can carry request URLs with embedded API keys, so nothing
 * upstream of this boundary may serialize a ProviderError without going
 * through `toSafeJSON()`.
 */
export type ProviderErrorCode =
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "CIRCUIT_OPEN"
  | "NOT_CONFIGURED"
  | "UPSTREAM_ERROR"
  | "UNKNOWN";

const RETRYABLE_CODES: ReadonlySet<ProviderErrorCode> = new Set(["TIMEOUT", "UPSTREAM_ERROR"]);

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly provider: string;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(params: {
    code: ProviderErrorCode;
    provider: string;
    message: string;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "ProviderError";
    this.code = params.code;
    this.provider = params.provider;
    this.retryable = RETRYABLE_CODES.has(params.code);
    this.cause = params.cause;
  }

  /**
   * The only representation allowed to cross the server-side proxy boundary
   * (see apps/api providers module). Deliberately omits `cause` — an upstream
   * error message or stack may contain a request URL with an embedded API key.
   */
  toSafeJSON(): { code: ProviderErrorCode; provider: string; message: string; retryable: boolean } {
    return {
      code: this.code,
      provider: this.provider,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

/** Converts any thrown value into a ProviderError, never re-throwing the original. */
export function normalizeError(provider: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new ProviderError({
      code: "TIMEOUT",
      provider,
      message: `${provider} request timed out`,
      cause: error,
    });
  }
  // The message is deliberately generic, never error.message: a raw upstream
  // error can carry a request URL with an embedded API key or other detail
  // that must not reach a client. The original is preserved in `cause` for
  // server-side logging only (see apps/api's exception filter).
  return new ProviderError({
    code: "UNKNOWN",
    provider,
    message: `${provider} failed with an unexpected error`,
    cause: error,
  });
}
