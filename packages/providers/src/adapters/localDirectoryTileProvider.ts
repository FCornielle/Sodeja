import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProviderError } from "../errors.js";
import type { HealthCheckResult } from "../health.js";
import type { TileProvider } from "../types.js";

/**
 * Reads pre-generated static tiles from a local directory
 * ({dir}/{z}/{x}/{y}.pbf) — the self-hosted PMTiles-derived base map
 * described in SODEJA_ARCHITECTURE.md ("pmtiles-local" is the documented MVP
 * default for TILE_PROVIDER). No tiles exist yet: ingestion (B-4) hasn't run,
 * so this correctly reports NOT_CONFIGURED / "unconfigured" until a directory
 * with real files is pointed at via TILES_LOCAL_DIR, rather than silently
 * returning nothing.
 */
export class LocalDirectoryTileProvider implements TileProvider {
  readonly name = "pmtiles-local";

  constructor(private readonly directory: string) {}

  async getTile(z: number, x: number, y: number): Promise<Buffer> {
    const path = join(this.directory, String(z), String(x), `${y}.pbf`);
    try {
      return await readFile(path);
    } catch (error) {
      throw new ProviderError({
        code: "NOT_CONFIGURED",
        provider: this.name,
        message: `No local tile at ${z}/${x}/${y}; has B-4 ingestion produced tiles under TILES_LOCAL_DIR?`,
        cause: error,
      });
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      await access(this.directory);
      return { provider: this.name, status: "ok" };
    } catch {
      return {
        provider: this.name,
        status: "unconfigured",
        detail: `TILES_LOCAL_DIR (${this.directory}) does not exist yet`,
      };
    }
  }
}
