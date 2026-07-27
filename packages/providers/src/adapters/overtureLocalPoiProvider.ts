import { ProviderError } from "../errors.js";
import type { HealthCheckResult } from "../health.js";
import type { Place, PoiProvider } from "../types.js";

/**
 * The documented MVP default for POI_PROVIDER (SODEJA_ARCHITECTURE.md,
 * apps/api/README.md): Overture Places data ingested into geo.poi_place
 * (specs/db/schema.sql), queried locally — no external call, no cost. The
 * query layer itself is B-5's job and is not implemented yet, so this
 * reports NOT_CONFIGURED / "unconfigured" honestly rather than silently
 * returning an empty result set that could be misread as "no competition
 * nearby" (risk D3).
 */
export class OvertureLocalPoiProvider implements PoiProvider {
  readonly name = "overture-local";

  async searchPlaces(): Promise<Place[]> {
    throw new ProviderError({
      code: "NOT_CONFIGURED",
      provider: this.name,
      message: "Overture POI query layer is wired in B-5 (POI ingestion/query layer); not yet available",
    });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return {
      provider: this.name,
      status: "unconfigured",
      detail: "B-5 (POI ingestion/query layer) not yet implemented",
    };
  }
}
