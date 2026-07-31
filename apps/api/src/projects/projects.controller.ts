import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import {
  AssumptionOverrideRequestSchema,
  CreateProjectRequestSchema,
  type AssumptionOverrideRequest,
  type AssumptionOverrideResponse,
  type CreateProjectRequest,
  type Project,
  type ProjectAssumption,
} from "@sodeja/schemas";
import { CurrentUserId } from "../common/current-user-id.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ProjectsService } from "./projects.service.js";

/**
 * B-11a. The project aggregate's assumptions sub-resource — see
 * apps/api/README.md for the exact wire contract:
 *
 * - `GET /projects/:id/assumptions` -> `ProjectAssumption[]` (a bare array,
 *   no envelope). First read materializes it if empty; every field is
 *   already the CURRENT effective value — read valueLow/valueBase/valueHigh
 *   directly, never re-resolve defaultParameterValueId.
 * - `PATCH /projects/:id/assumptions/:key` -> `{ assumption, invalidated }`.
 *   `invalidated` names the `app.*` estimate tables that are now
 *   potentially stale; it is a hint, not proof of recomputation.
 * - `POST /projects` -> `Project`. Minimal, no update/delete/list.
 */
@Controller("projects")
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  async create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(CreateProjectRequestSchema)) body: CreateProjectRequest,
  ): Promise<Project> {
    return this.projectsService.createProject(userId, body);
  }

  @Get(":id/assumptions")
  async getAssumptions(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
  ): Promise<ProjectAssumption[]> {
    return this.projectsService.getAssumptions(userId, projectId);
  }

  @Patch(":id/assumptions/:key")
  async overrideAssumption(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(AssumptionOverrideRequestSchema)) body: AssumptionOverrideRequest,
  ): Promise<AssumptionOverrideResponse> {
    return this.projectsService.overrideAssumption(userId, projectId, key, body);
  }
}
