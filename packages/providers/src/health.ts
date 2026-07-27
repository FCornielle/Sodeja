/**
 * "unconfigured" is distinct from "down": a credentialed adapter (Google,
 * Mapbox, MapTiler, ...) with no API key set reports "unconfigured" from a
 * pure config check, never by attempting a network call. That keeps health
 * checks free of any live traffic to a paid API before one is approved.
 */
export type HealthState = "ok" | "degraded" | "down" | "unconfigured";

export interface HealthCheckResult {
  provider: string;
  status: HealthState;
  detail?: string;
}

export interface HealthCheckable {
  healthCheck(): Promise<HealthCheckResult>;
}

export async function aggregateHealth(
  checkables: readonly HealthCheckable[],
): Promise<HealthCheckResult[]> {
  return Promise.all(checkables.map((checkable) => checkable.healthCheck()));
}
