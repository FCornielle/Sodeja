import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { withUserSession } from "@sodeja/db";
import { createLogger } from "@sodeja/observability";
import { evaluatePermits } from "@sodeja/rules";
import type { PermitChecklist } from "@sodeja/schemas";
import { requireConfirmedArea } from "../common/area-gate.js";
import {
  fetchBusinessTypeSlugById,
  fetchJurisdictionById,
  fetchProjectContext,
} from "./permits.repository.js";

const logger = createLogger("api:permits");

/**
 * Rendered verbatim by the client (`PermitChecklistSchema.disclaimerEs`).
 * Every clause here is load-bearing rather than boilerplate: the
 * non-exhaustiveness is a legal fact (Ley 176-07 Art. 16, cited on the
 * municipal-licence item itself), the named gaps are the ones
 * packages/db/migrations/1785560000000_seed-permits-content.sql deliberately
 * refused to seed, and the "no lawyer reviewed this" statement records a
 * product-owner decision, not a hedge.
 */
const DISCLAIMER_ES =
  "Esta lista NO es exhaustiva y NO constituye asesoría legal. Recoge únicamente los requisitos " +
  "que pudieron verificarse en el texto primario de la fuente citada; hay requisitos reales que " +
  "no aparecen aquí (entre otros, la autorización ambiental de la Ley 64-00 y las licencias de " +
  "venta de alcohol y tabaco, deliberadamente no incluidas por no haberse podido verificar). " +
  "Ningún elemento de esta lista significa que su negocio esté en regla: la Ley 176-07, Art. 16, " +
  "establece que las licencias otorgadas por otros organismos públicos no eximen de obtener las " +
  "municipales correspondientes. Este contenido no ha sido revisado por un abogado. Confirme cada " +
  "trámite con la institución correspondiente antes de comprometer capital.";

/**
 * B-18 (Module 12, permits checklist). This service computes nothing itself:
 * `evaluatePermits` (`packages/rules/src/evaluate.ts`) fetches the
 * jurisdiction chain plus every in-scope rule pack/rule/citation and hands
 * them to the pure `evaluatePermitRules` interpreter that B-10 built. What
 * this service owns is the project-shaped part of the question — which
 * jurisdiction, which business type, and whether we know where the project is
 * at all.
 *
 * A pure read, like `layout` and unlike the POST-and-persist estimate
 * modules. `app.permit_checklist_item` exists in the schema for a
 * materialized, user-trackable checklist (`user_marked_done`, and preserving
 * the list a user actually saw after its rule pack is superseded), but
 * materializing it needs a product decision B-18 does not contain: WHEN the
 * checklist freezes, and what happens to a user's ticked boxes when the
 * underlying pack changes. Guessing that would silently define the answer, so
 * the table stays empty and this endpoint recomputes on every call.
 */
@Injectable()
export class PermitsService {
  async getPermitsChecklist(userId: string, projectId: string): Promise<PermitChecklist> {
    return withUserSession(userId, async (client) => {
      const context = await fetchProjectContext(client, projectId);
      if (!context) {
        // RLS already filtered out projects this user cannot see, so "not
        // found" and "not yours" are indistinguishable here by design.
        throw new NotFoundException(`project ${projectId} not found`);
      }

      // B-7a's gate (risk T1). Permits are not computed FROM the area, but
      // confirming the location is where the project's jurisdiction gets
      // resolved — and a permits checklist for the wrong municipality is
      // worse than no checklist, since it names offices that will not
      // process the applicant.
      await requireConfirmedArea(client, projectId);

      if (context.jurisdictionId === null) {
        throw new ConflictException(
          `project ${projectId} has no jurisdiction resolved — every municipal requirement (uso de suelo, ` +
            "licencia de apertura) is jurisdiction-specific, so no checklist can be produced without one",
        );
      }
      const jurisdiction = await fetchJurisdictionById(client, context.jurisdictionId);
      if (!jurisdiction) {
        throw new ConflictException(
          `project's jurisdiction_id ${context.jurisdictionId} no longer exists`,
        );
      }

      if (context.businessTypeId === null) {
        throw new ConflictException("project has no business type set; cannot evaluate permit rules");
      }
      const businessTypeSlug = await fetchBusinessTypeSlugById(client, context.businessTypeId);
      if (!businessTypeSlug) {
        throw new ConflictException(`project's business_type_id ${context.businessTypeId} no longer exists`);
      }

      const asOfDate = new Date().toISOString().slice(0, 10);
      const { results, failures } = await evaluatePermits({
        // `businessTypeSlug` is the only fact any seeded rule keys on (the
        // food-handling pair); everything else is unconditional `true`. A
        // fact this endpoint cannot supply must never be faked — an absent
        // fact makes a conditional rule not fire, which is the safe
        // direction, whereas a guessed one manufactures a requirement.
        facts: { businessTypeSlug },
        jurisdictionSlug: jurisdiction.slug,
        asOfDate,
        client,
      });

      if (failures.length > 0) {
        // A failure means seeded content is malformed (unparseable condition,
        // missing or unverified citation), which means the checklist we could
        // return is missing items with no way to say which. Serving that
        // silently is exactly the L3 harm this module exists to avoid, so it
        // is a loud 500 instead. Rule codes go to the client (they are our own
        // content identifiers and name what to fix); the interpreter's
        // messages go to the log only.
        logger.error({ projectId, jurisdictionSlug: jurisdiction.slug, asOfDate, failures }, "permit rule evaluation failures");
        throw new InternalServerErrorException(
          "the permits checklist could not be produced: " +
            `${failures.length} seeded permit rule(s) failed to evaluate ` +
            `(${failures.map((f) => f.ruleCode).join(", ")}). A partial permits checklist is never served.`,
        );
      }

      return {
        items: results,
        jurisdictionSlug: jurisdiction.slug,
        jurisdictionName: jurisdiction.name,
        businessTypeSlug,
        asOfDate,
        isExhaustive: false,
        disclaimerEs: DISCLAIMER_ES,
      };
    });
  }
}
