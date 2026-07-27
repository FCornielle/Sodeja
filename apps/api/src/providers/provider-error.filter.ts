import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { createLogger } from "@sodeja/observability";
import { ProviderError, type ProviderErrorCode } from "@sodeja/providers";
import type { Response } from "express";

const logger = createLogger("api:providers");

const STATUS_BY_CODE: Record<ProviderErrorCode, number> = {
  TIMEOUT: 504,
  RATE_LIMITED: 429,
  CIRCUIT_OPEN: 503,
  NOT_CONFIGURED: 503,
  UPSTREAM_ERROR: 502,
  UNKNOWN: 500,
};

/**
 * The only place a ProviderError becomes an HTTP response. Full detail
 * (including `cause`, which may carry a request URL with an embedded API
 * key) is logged server-side only; the client gets exactly
 * `ProviderError.toSafeJSON()` and nothing else — see the "secret isolation"
 * integration tests in providers.controller.test.ts.
 */
@Catch(ProviderError)
export class ProviderErrorFilter implements ExceptionFilter {
  catch(exception: ProviderError, host: ArgumentsHost): void {
    logger.warn(
      { code: exception.code, provider: exception.provider, cause: exception.cause },
      "provider request failed",
    );

    const response = host.switchToHttp().getResponse<Response>();
    const status = STATUS_BY_CODE[exception.code] ?? 500;
    response.status(status).json(exception.toSafeJSON());
  }
}
