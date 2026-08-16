import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { withUserSession } from "@sodeja/db";
import { fetchJurisdictions, fetchParameterValues, findBestParameterValue, resolveJurisdictionChain } from "@sodeja/rules";
import type {
  AssumptionOverrideRequest,
  AssumptionOverrideResponse,
  ConfirmProjectLocationRequest,
  CreateProjectRequest,
  Project,
  ProjectAssumption,
  ProjectLocation,
  ProjectPoiLabel,
} from "@sodeja/schemas";
import { requireConfirmedArea } from "../common/area-gate.js";
import { estimatesInvalidatedByDomain } from "./assumption-invalidation.js";
import {
  fetchAllParameterTables,
  fetchAssumptionByKey,
  fetchAssumptionDomain,
  fetchAssumptions,
  fetchBusinessTypeById,
  fetchConfirmedCentroid,
  fetchJurisdictionSlugById,
  fetchNearestPoi,
  fetchParameterValueLowHigh,
  fetchProjectCore,
  findPersonalOrgId,
  insertMaterializedAssumptions,
  insertProject,
  updateAssumptionOverride,
  upsertConfirmedLocation,
  type MaterializedAssumption,
  type ProjectAssumptionRow,
  type ProjectLocationRow,
  type ProjectRow,
} from "./projects.repository.js";

function toProjectDto(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    businessTypeId: row.businessTypeId,
    jurisdictionId: row.jurisdictionId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function toLocationDto(row: ProjectLocationRow): ProjectLocation {
  return {
    projectId: row.projectId,
    areaSqm: row.areaSqm,
    areaSource: row.areaSource,
    areaConfirmedAt: row.areaConfirmedAt.toISOString(),
    centroidLon: row.centroidLon,
    centroidLat: row.centroidLat,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAssumptionDto(row: ProjectAssumptionRow): ProjectAssumption {
  return {
    id: row.id,
    projectId: row.projectId,
    key: row.key,
    labelEs: row.labelEs,
    unit: row.unit,
    valueLow: row.valueLow,
    valueBase: row.valueBase,
    valueHigh: row.valueHigh,
    currency: row.currency,
    provenance: row.provenance,
    defaultParameterValueId: row.defaultParameterValueId,
    isOverridden: row.isOverridden,
    implausibleFlag: row.implausibleFlag,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * B-8 POI use-label search radius, in meters.
 *
 * 40m, because the two points being compared are not the same kind of point:
 * the project centroid is a building footprint's geometric centre, while an
 * Overture place is geocoded to an address or entrance, which for a mid-block
 * commercial building sits at the street edge — tens of meters off the
 * centroid. The radius has to absorb that offset without reaching past it:
 * a DR urban block in the launch areas (Distrito Nacional / Santo Domingo /
 * Santiago) runs roughly 80-100m, so 40m stays inside the block and cannot
 * pick up the business across the street and label it as this site's.
 *
 * Erring small is the right direction here: a missed label costs the user one
 * extra typed answer, while a wrong label is a confident-looking claim about
 * their site that they may not think to correct — the same "no answer beats a
 * fabricated one" posture B-9's null demand index takes.
 */
const POI_LABEL_RADIUS_M = 40;

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23503"
  );
}

/**
 * B-11a. See apps/api/README.md and the module-level doc comment on
 * ProjectsController for the exact wire contract this owns.
 */
@Injectable()
export class ProjectsService {
  /**
   * The minimal `POST /projects` this item adds — just enough to make the
   * assumptions sub-resource testable end-to-end (no update/delete/list;
   * that is full `projects` CRUD, out of B-11a's scope).
   */
  async createProject(userId: string, input: CreateProjectRequest): Promise<Project> {
    return withUserSession(userId, async (client) => {
      const orgId = await findPersonalOrgId(client, userId);
      if (!orgId) {
        // Should not happen: app.handle_new_user creates exactly one personal
        // org per auth.users row on insert. Surfacing this as 409 rather than
        // 500 makes the (expected-impossible) case legible in tests without
        // pretending it is a client input error.
        throw new ConflictException(
          "no personal organization found for this user (expected one to exist from account creation)",
        );
      }
      try {
        const row = await insertProject(client, { ownerId: userId, orgId, ...input });
        return toProjectDto(row);
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new ConflictException(
            "businessTypeId or jurisdictionId does not reference an existing row",
          );
        }
        throw error;
      }
    });
  }

  /**
   * B-7a. The area-confirmation gate: `PUT /projects/:id/location`.
   * Idempotent — `project_id` is the primary key on `app.project_location`,
   * so re-calling this re-confirms rather than erroring. This is what
   * unblocks the 409 gate enforced by `apps/api/src/common/area-gate.ts` for
   * capacity/fit-out/opex.
   *
   * B-8 lets the caller declare `areaSource`; absent, it defaults to
   * `'user_entered'` in `upsertConfirmedLocation` (see its doc comment for
   * why the API never infers the provenance itself).
   */
  async confirmLocation(
    userId: string,
    projectId: string,
    input: ConfirmProjectLocationRequest,
  ): Promise<ProjectLocation> {
    return withUserSession(userId, async (client) => {
      const core = await fetchProjectCore(client, projectId);
      if (!core) {
        // Same RLS-driven "not found" vs "not yours" ambiguity as getAssumptions.
        throw new NotFoundException(`project ${projectId} not found`);
      }
      const row = await upsertConfirmedLocation(client, projectId, input);
      return toLocationDto(row);
    });
  }

  /**
   * B-8. What `geo.poi_place` thinks is currently at the project's confirmed
   * site, so the UI can show "there is a [category] here" and let the user
   * confirm or correct it. Finding nothing is a real, common answer — it
   * returns all-`null`, never a 404 (informal DR businesses are invisible to
   * every dataset, risk D2: absence of a record is not absence of a
   * business).
   */
  async getPoiLabel(userId: string, projectId: string): Promise<ProjectPoiLabel> {
    return withUserSession(userId, async (client) => {
      const core = await fetchProjectCore(client, projectId);
      if (!core) {
        // Same RLS-driven "not found" vs "not yours" ambiguity as getAssumptions.
        throw new NotFoundException(`project ${projectId} not found`);
      }

      // B-7a's gate (risk T1): asking what is at the site only means anything
      // once the user has said where the site is.
      await requireConfirmedArea(client, projectId);

      const centroid = await fetchConfirmedCentroid(client, projectId);
      if (!centroid) {
        // requireConfirmedArea already asserted area_confirmed_at IS NOT NULL,
        // so this would mean the row vanished between the two reads — fail
        // loudly rather than look up a POI near a null point.
        throw new Error(`internal: project ${projectId} passed the area gate but has no confirmed centroid`);
      }

      const poi = await fetchNearestPoi(client, centroid.lon, centroid.lat, POI_LABEL_RADIUS_M);
      if (!poi) return { category: null, name: null, distanceM: null, sourceVintage: null };
      return {
        category: poi.category,
        name: poi.name,
        distanceM: poi.distanceM,
        sourceVintage: poi.sourceVintage,
      };
    });
  }

  /**
   * Returns every `app.project_assumption` row for the project. On first
   * read (no rows exist yet) materializes one row per `content.parameter_table`
   * that resolves for the project's business type + jurisdiction + today's
   * date — across EVERY domain currently seeded (tax/labor/construction/
   * capacity/layout/rent/utilities), not only 'capacity'. That currently
   * includes B-10's national labor-domain statutory rates (TSS ceilings,
   * INFOTEP, and all four company-size minimum-wage tiers) alongside B-11's
   * capacity ratios. Which wage tier actually applies to a given business is
   * a legal determination (Ley 488-08 dual criteria), not a materialization
   * choice — left to B-15, deliberately not filtered out here.
   */
  async getAssumptions(userId: string, projectId: string): Promise<ProjectAssumption[]> {
    return withUserSession(userId, async (client) => {
      const existing = await fetchAssumptions(client, projectId);
      if (existing.length > 0) return existing.map(toAssumptionDto);

      const core = await fetchProjectCore(client, projectId);
      if (!core) {
        // RLS already filtered out projects this user cannot see, so "not
        // found" and "not yours" are indistinguishable here by design.
        throw new NotFoundException(`project ${projectId} not found`);
      }
      if (core.businessTypeId === null) {
        throw new ConflictException("project has no business type set; cannot materialize assumptions");
      }

      const businessType = await fetchBusinessTypeById(client, core.businessTypeId);
      if (!businessType) {
        throw new ConflictException(`project's business_type_id ${core.businessTypeId} no longer exists`);
      }

      let jurisdictionChain: ReturnType<typeof resolveJurisdictionChain> | undefined;
      if (core.jurisdictionId !== null) {
        const slug = await fetchJurisdictionSlugById(client, core.jurisdictionId);
        if (slug) {
          const jurisdictions = await fetchJurisdictions(client);
          jurisdictionChain = resolveJurisdictionChain(jurisdictions, slug);
        }
      }

      const asOfDate = new Date().toISOString().slice(0, 10);
      const parameterTables = await fetchAllParameterTables(client);

      const materialized: MaterializedAssumption[] = [];
      for (const parameterTable of parameterTables) {
        const parameterValues = await fetchParameterValues(client, parameterTable.id);
        if (parameterValues.length === 0) continue;
        const best = findBestParameterValue({
          parameterTable,
          parameterValues,
          asOfDate,
          businessType,
          ...(jurisdictionChain ? { jurisdictionChain } : {}),
        });
        if (!best) continue;
        materialized.push({
          key: parameterTable.slug,
          labelEs: parameterTable.nameEs,
          unit: parameterTable.unit,
          valueLow: best.valueLow,
          valueBase: best.valueBase,
          valueHigh: best.valueHigh,
          currency: best.currency,
          provenance: best.provenance,
          defaultParameterValueId: best.id,
        });
      }

      const inserted = await insertMaterializedAssumptions(client, projectId, materialized);
      return inserted.map(toAssumptionDto);
    });
  }

  /**
   * Sets a new low/base/high on one assumption (`is_overridden = true`),
   * flags `implausible_flag` against the ORIGINAL default's band (never the
   * assumption row's own current band, which may already reflect a prior
   * override), and returns which estimate types are now potentially stale.
   */
  async overrideAssumption(
    userId: string,
    projectId: string,
    key: string,
    input: AssumptionOverrideRequest,
  ): Promise<AssumptionOverrideResponse> {
    return withUserSession(userId, async (client) => {
      const existing = await fetchAssumptionByKey(client, projectId, key);
      if (!existing) {
        throw new NotFoundException(
          `assumption "${key}" not found for project ${projectId} ` +
            "(GET /projects/:id/assumptions first to materialize it)",
        );
      }

      let implausible = false;
      if (existing.defaultParameterValueId !== null) {
        const band = await fetchParameterValueLowHigh(client, existing.defaultParameterValueId);
        if (band) {
          implausible = input.valueBase < band.valueLow || input.valueBase > band.valueHigh;
        }
      }

      const updated = await updateAssumptionOverride(client, existing.id, {
        valueLow: input.valueLow,
        valueBase: input.valueBase,
        valueHigh: input.valueHigh,
        implausibleFlag: implausible,
      });

      const domain = await fetchAssumptionDomain(client, existing.id);
      const invalidated = estimatesInvalidatedByDomain(domain);

      return { assumption: toAssumptionDto(updated), invalidated };
    });
  }
}
