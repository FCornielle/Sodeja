import { ConflictException } from "@nestjs/common";
import type { QueryClient } from "@sodeja/rules";

/**
 * B-7a's area confirmation gate, enforced for real rather than merely
 * documented (docs/SODEJA_MVP_BACKLOG.md Phase 0 refinements item 4; risk
 * T1). `capacity`, `fitout` and `opex` estimates must never be produced from
 * an unconfirmed area — a `409` here, not a silent fallback to `0` or
 * `null`, is the entire point of this function.
 *
 * Shared by the `capacity` and `costs` modules (rather than duplicated three
 * times) because both must agree on exactly the same gate against exactly
 * the same `app.project_location` row. That table is project-aggregate data
 * no single NestJS module owns exclusively yet — the same status
 * `content.*` reference tables already have, independently queried by both
 * `catalog` and `projects` (apps/api/README.md "Architectural rules").
 *
 * Returns the confirmed area in m² on success.
 */
export async function requireConfirmedArea(client: QueryClient, projectId: string): Promise<number> {
  const { rows } = await client.query<{ area_sqm: string | null; area_confirmed_at: Date | null }>(
    "SELECT area_sqm, area_confirmed_at FROM app.project_location WHERE project_id = $1",
    [projectId],
  );
  const row = rows[0];
  if (!row || row.area_confirmed_at === null || row.area_sqm === null) {
    throw new ConflictException(
      `project ${projectId} has no confirmed area — PUT /projects/:id/location first ` +
        "(risk T1: an unconfirmed area must never enter a downstream calculation)",
    );
  }
  return Number(row.area_sqm);
}
