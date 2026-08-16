import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import type { PermitChecklist } from "@sodeja/schemas";
import { CurrentUserId } from "../common/current-user-id.decorator.js";
import { PermitsService } from "./permits.service.js";

/**
 * B-18 (Module 12, permits checklist). `GET /projects/:id/permits-checklist`
 * — a pure read, like `layout` and unlike the POST-and-persist estimate
 * modules; see permits.service.ts for why `app.permit_checklist_item` is not
 * materialized here.
 *
 * **The response is non-exhaustive by construction and is not legal advice.**
 * `isExhaustive` is always `false` and `disclaimerEs` must be rendered as
 * visible copy. There is no response value meaning "compliant" or "cleared"
 * and there must never be one (risk L3, docs/SODEJA_RISKS.md): a false
 * all-clear can cost a user their fit-out capital.
 *
 * `409` if the project's area is not confirmed yet (B-7a gate), if it has no
 * jurisdiction resolved, or if it has no business type set; `404` if the
 * project does not exist or is not the caller's; `500` if seeded rule content
 * is malformed, rather than a silently shortened checklist.
 */
@Controller("projects")
export class PermitsController {
  constructor(private readonly permitsService: PermitsService) {}

  @Get(":id/permits-checklist")
  async getPermitsChecklist(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
  ): Promise<PermitChecklist> {
    return this.permitsService.getPermitsChecklist(userId, projectId);
  }
}
