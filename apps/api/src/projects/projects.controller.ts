import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import {
  AssumptionOverrideRequestSchema,
  ConfirmProjectLocationRequestSchema,
  CreateProjectRequestSchema,
  type AssumptionOverrideRequest,
  type AssumptionOverrideResponse,
  type ConfirmProjectLocationRequest,
  type CreateProjectRequest,
  type Project,
  type ProjectAssumption,
  type ProjectLocation,
  type ProjectPoiLabel,
} from "@sodeja/schemas";
import { CurrentUserId } from "../common/current-user-id.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ProjectsService } from "./projects.service.js";

/**
 * B-11a. The project aggregate's assumptions sub-resource — see
 * apps/api/README.md for the exact wire contract:
 *
 * - `PUT /projects/:id/location` -> `ProjectLocation` (B-7a). Body
 *   `{ areaSqm, centroidLon, centroidLat, areaSource? }`. Writes the
 *   caller's `areaSource` (B-8), defaulting to `'user_entered'` when absent,
 *   and `area_confirmed_at = now()` — this is the gate capacity/fit-out/opex
 *   enforce as a `409` when absent (see `apps/api/src/common/area-gate.ts`).
 * - `GET /projects/:id/poi-label` -> `ProjectPoiLabel` (B-8). The nearest
 *   known POI to the confirmed site. All-`null` when nothing is nearby —
 *   a valid answer, never a `404`. `409` behind the same area gate.
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

  @Put(":id/location")
  async confirmLocation(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodValidationPipe(ConfirmProjectLocationRequestSchema)) body: ConfirmProjectLocationRequest,
  ): Promise<ProjectLocation> {
    return this.projectsService.confirmLocation(userId, projectId, body);
  }

  @Get(":id/poi-label")
  async getPoiLabel(
    @CurrentUserId() userId: string,
    @Param("id", new ParseUUIDPipe()) projectId: string,
  ): Promise<ProjectPoiLabel> {
    return this.projectsService.getPoiLabel(userId, projectId);
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
