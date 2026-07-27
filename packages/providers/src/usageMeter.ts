export interface UsageSnapshot {
  provider: string;
  operation: string;
  count: number;
}

export interface UsageStore {
  record(provider: string, operation: string): void;
  getUsage(provider?: string): UsageSnapshot[];
  reset(): void;
}

/**
 * In-memory by design (SODEJA_ARCHITECTURE.md: CACHE_DRIVER=memory default,
 * single API instance at Phase 1 scale). A persistent implementation of this
 * same interface can be added later (e.g. backed by Postgres) without
 * changing any call site — see @sodeja/db's session helpers for the seam
 * pattern this mirrors.
 */
export class InMemoryUsageStore implements UsageStore {
  private readonly counts = new Map<string, number>();

  private static key(provider: string, operation: string): string {
    return `${provider}::${operation}`;
  }

  record(provider: string, operation: string): void {
    const key = InMemoryUsageStore.key(provider, operation);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  getUsage(provider?: string): UsageSnapshot[] {
    const snapshots: UsageSnapshot[] = [];
    for (const [key, count] of this.counts) {
      const [recordedProvider, operation] = key.split("::") as [string, string];
      if (provider && recordedProvider !== provider) continue;
      snapshots.push({ provider: recordedProvider, operation, count });
    }
    return snapshots;
  }

  reset(): void {
    this.counts.clear();
  }
}

/**
 * Wraps a provider call to record usage. Recording happens in `finally`,
 * counting failed attempts too: a provider typically bills for a request
 * that reached its network, regardless of whether it then errored or timed
 * out. Calls rejected by the rate limiter or circuit breaker never reach this
 * wrapper (they never touch the network), so they are correctly never
 * metered — see apps/api's providers controller for call order.
 */
export class UsageMeter {
  constructor(private readonly store: UsageStore = new InMemoryUsageStore()) {}

  async track<T>(provider: string, operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } finally {
      this.store.record(provider, operation);
    }
  }

  getUsage(provider?: string): UsageSnapshot[] {
    return this.store.getUsage(provider);
  }

  reset(): void {
    this.store.reset();
  }
}
