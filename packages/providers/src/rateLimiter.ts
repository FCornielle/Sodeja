import { ProviderError } from "./errors.js";

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counter, keyed by an arbitrary string (a user id, an IP, or a
 * "scope:key" composite). In-memory by design (SODEJA_ARCHITECTURE.md
 * infrastructure posture: CACHE_DRIVER=memory by default) — a single API
 * instance is the Phase 1 deployment target, so no shared store is needed
 * yet. Swapping to a Redis-backed implementation later is a drop-in behind
 * this same check()/reset() shape.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly rule: RateLimitRule,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns true and consumes one unit if the key is within its limit. */
  check(key: string): boolean {
    const now = this.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.rule.windowMs });
      return true;
    }

    if (existing.count >= this.rule.limit) {
      return false;
    }

    existing.count += 1;
    return true;
  }

  reset(key: string): void {
    this.windows.delete(key);
  }
}

/**
 * Applies BOTH a per-user and a per-IP limiter, independently. An
 * authenticated user is still IP-limited (catches shared-account abuse from
 * one address), and an anonymous caller is caught by the IP limit alone when
 * no user id is available. Either limiter tripping rejects the call.
 */
export class DualRateLimiter {
  constructor(
    private readonly perUser: RateLimiter,
    private readonly perIp: RateLimiter,
  ) {}

  checkOrThrow(provider: string, params: { userId?: string; ip: string }): void {
    if (params.userId && !this.perUser.check(params.userId)) {
      throw new ProviderError({
        code: "RATE_LIMITED",
        provider,
        message: `Rate limit exceeded for user ${params.userId}`,
      });
    }
    if (!this.perIp.check(params.ip)) {
      throw new ProviderError({
        code: "RATE_LIMITED",
        provider,
        message: `Rate limit exceeded for IP ${params.ip}`,
      });
    }
  }
}
