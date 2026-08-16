import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { ReportStorage } from "./types.js";

/**
 * The B-19 task brief's "minimal filesystem-backed storage module" —
 * `STORAGE_DRIVER=filesystem` is this monorepo's existing free/local default
 * (apps/api/README.md "Free and local tiers only"; `packages/providers` has
 * no object-storage adapter yet, so this is genuinely new, scoped to
 * `services/pdf-worker` since nothing else needs it today).
 *
 * IMPORTANT — what "download" means with this driver, and why:
 * `services/pdf-worker/README.md` describes signed-URL issuance as part of
 * the storage interface. A REAL signed URL (time-limited, cryptographically
 * unguessable, independently verifiable without hitting the API) is not a
 * meaningful concept for a plain local directory — there is no separate
 * object-storage service to issue a token against. `GET
 * /projects/:id/reports/:reportId/download` (apps/api/src/reports/
 * reports.controller.ts) is therefore a DIRECT, AUTHENTICATED download
 * endpoint: it is protected the same way every other project-scoped route
 * is (the `x-user-id` header + RLS ownership check on `app.report`), not by
 * URL secrecy. This is an honest simplification appropriate to local/free
 * storage, NOT a substitute security feature — a real `STORAGE_DRIVER=gcs`
 * (or similar) implementation would need genuine signed-URL issuance (a
 * time-limited token minted by the storage provider itself), and swapping
 * to it should replace this class behind the same `ReportStorage` interface
 * (types.ts) without changing the controller's shape.
 */
export class FilesystemReportStorage implements ReportStorage {
  constructor(private readonly baseDir: string) {}

  async save(key: string, data: Buffer): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolvePath(key));
    } catch (error) {
      if (isEnoent(error)) return null;
      throw error;
    }
  }

  /**
   * Keys are always server-generated (`${projectId}/${reportId}.pdf` —
   * reports.service.ts's `storageKeyFor`), never taken directly from a
   * client request, so path-traversal input is not the expected threat
   * model here. This guard exists anyway as defense in depth: resolves the
   * key against `baseDir` and rejects anything that would escape it, rather
   * than trusting every future caller of `save`/`read` to keep that
   * invariant.
   */
  private resolvePath(key: string): string {
    const resolvedBase = path.resolve(this.baseDir);
    const resolved = path.resolve(resolvedBase, key);
    if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
      throw new Error(`refusing to resolve storage key outside its base directory: ${key}`);
    }
    return resolved;
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "ENOENT";
}
