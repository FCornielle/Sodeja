"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@sodeja/schemas";
import { BusinessTypeStep } from "../components/business-type/BusinessTypeStep";

const LAST_PROJECT_KEY = "sodeja:last-project-id";

/**
 * Step 4 — Tipo de negocio (Module 5), the real screen. Replaces the
 * former dev-only bootstrap page entirely: business type + jurisdiction
 * selection now genuinely creates a project via `POST /projects`, using the
 * two small backend additions this change also makes (`id` on
 * `GET /business-types`, and the new `GET /jurisdictions`) instead of a raw
 * numeric-id form. See `components/business-type/BusinessTypeStep.tsx`'s doc
 * comment for why this screen runs BEFORE Step 1's map rather than after it,
 * per the UX spec's idealized order.
 *
 * There is still no Step 0 (login) and no project list/dashboard (both
 * separate, unbuilt backlog items) — so a returning user has no other way
 * back into a project they already started. Rather than resurrect the old
 * bootstrap's raw-UUID paste box (a dev tool, not a real affordance), this
 * page offers a single convenience link back into the last project this
 * BROWSER created, via the same `localStorage` key `ProjectFlow` already
 * relies on. That is a judgment call, not a spec requirement.
 */
export default function BusinessTypePage() {
  const router = useRouter();
  const [lastProjectId, setLastProjectId] = useState<string | null>(null);

  useEffect(() => {
    setLastProjectId(window.localStorage.getItem(LAST_PROJECT_KEY));
  }, []);

  function goToProject(id: string): void {
    window.localStorage.setItem(LAST_PROJECT_KEY, id);
    router.push(`/project/${id}`);
  }

  return (
    <main className="min-h-screen">
      {lastProjectId !== null && (
        <div className="mx-auto max-w-2xl px-6 pt-6">
          <button
            type="button"
            onClick={() => goToProject(lastProjectId)}
            className="text-sm text-blue-600 underline"
          >
            Continuar con tu proyecto anterior
          </button>
        </div>
      )}
      <BusinessTypeStep onCreated={(project: Project) => goToProject(project.id)} />
    </main>
  );
}
