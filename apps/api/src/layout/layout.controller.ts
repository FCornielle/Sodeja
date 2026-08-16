import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import type { LayoutParameters } from "@sodeja/schemas";
import { CurrentUserId } from "../common/current-user-id.decorator.js";
import { LayoutService } from "./layout.service.js";

/**
 * B-13 (Module 4, layout). `GET /projects/:id/layout-parameters` — a pure
 * read, unlike the `POST`-and-persist shape every other estimate module has,
 * because there is no layout estimate to persist: the zone split is
 * user-entered and the allocation runs client-side in `@sodeja/calc`
 * (`app.layout_zone`/`content.layout_template` stay empty — see
 * packages/db/migrations/1785550000000_seed-layout-parameters.sql). `409` if
 * the project's area is not confirmed yet (B-7a gate) or it has no business
 * type set; `404` if the project does not exist or is not the caller's.
 */
@Controller("projects")
export class LayoutController {
  constructor(private readonly layoutService: LayoutService) {}

  @Get(":id/layout-parameters")
  async getLayoutParameters(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
  ): Promise<LayoutParameters> {
    return this.layoutService.getLayoutParameters(userId, projectId);
  }
}
