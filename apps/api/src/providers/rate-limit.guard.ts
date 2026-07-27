import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { DualRateLimiter, RateLimiter } from "@sodeja/providers";
import type { Request } from "express";

/**
 * Per-user AND per-IP, independently (see @sodeja/providers's
 * DualRateLimiter doc comment). `x-user-id` is a placeholder identity source:
 * real auth (Supabase JWT verification) is not built yet — that's the `auth`
 * module in apps/api/README.md's table, a later backlog item. Until then, an
 * absent header simply means only the per-IP limit applies, which is still a
 * real, enforced limit.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiter = new DualRateLimiter(
    new RateLimiter({
      limit: Number(process.env.RATE_LIMIT_PER_USER_PER_MIN ?? 60),
      windowMs: 60_000,
    }),
    new RateLimiter({
      limit: Number(process.env.RATE_LIMIT_PER_IP_PER_MIN ?? 120),
      windowMs: 60_000,
    }),
  );

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.header("x-user-id") || undefined;
    const ip = request.ip ?? request.socket.remoteAddress ?? "unknown";

    // Throws a ProviderError({ code: "RATE_LIMITED" }) on violation; the
    // global ProviderErrorFilter maps it to HTTP 429.
    this.limiter.checkOrThrow("providers-proxy", { userId, ip });
    return true;
  }
}
