"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@sodeja/schemas";
import { apiFetch, ApiError } from "../lib/apiClient";

const LAST_PROJECT_KEY = "sodeja:last-project-id";

/**
 * DEV-ONLY BOOTSTRAP — NOT part of the UX spec's 9-step primary flow.
 *
 * The real flow reaches Step 1 (map) only after Step 0 (login, out of B-7's
 * scope) and, in practice, after Step 4 (business-type selection, also out
 * of scope) has created a project — `POST /projects` (B-11a) requires a
 * `businessTypeId` and `jurisdictionId`, and `GET /business-types` (the only
 * catalog endpoint this app can call) does not expose the numeric id either
 * schema needs (@sodeja/schemas' `BusinessTypeCatalogEntrySchema` only
 * returns `slug`). With no way to discover those ids from inside this app's
 * in-scope endpoints, this screen exists purely so Steps 1-2 and Secondary
 * Flow A are testable end-to-end, exactly like the `x-user-id` placeholder
 * this app also uses (lib/userId.ts) — a labelled, temporary substitute for
 * a screen (Step 4) that is a separate, unbuilt backlog item.
 */
export default function BootstrapPage() {
  const router = useRouter();
  const [existingId, setExistingId] = useState("");
  const [name, setName] = useState("Proyecto de prueba");
  const [businessTypeId, setBusinessTypeId] = useState("1");
  const [jurisdictionId, setJurisdictionId] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function goToProject(id: string): void {
    window.localStorage.setItem(LAST_PROJECT_KEY, id);
    router.push(`/project/${id}`);
  }

  async function handleCreate(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const project = await apiFetch<Project>("/projects", {
        method: "POST",
        body: {
          name,
          businessTypeId: Number(businessTypeId),
          jurisdictionId: Number(jurisdictionId),
        },
      });
      goToProject(project.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el proyecto.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">SODEJA — B-7 (desarrollo)</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Esta pantalla no es parte del flujo real (Pasos 0 y 4 no están construidos en este
          cambio). Es solo una forma de obtener un <code>projectId</code> para probar los Pasos
          1-2 y el Flujo Secundario A de extremo a extremo.
        </p>
      </div>

      <section className="rounded border border-neutral-200 p-4">
        <h2 className="text-sm font-semibold text-neutral-800">Usar un proyecto existente</h2>
        <input
          value={existingId}
          onChange={(e) => setExistingId(e.target.value)}
          placeholder="UUID del proyecto"
          className="mt-2 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={existingId.trim().length === 0}
          onClick={() => goToProject(existingId.trim())}
          className="mt-2 w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Continuar
        </button>
      </section>

      <section className="rounded border border-neutral-200 p-4">
        <h2 className="text-sm font-semibold text-neutral-800">Crear un proyecto de prueba</h2>
        <label className="mt-2 block text-xs text-neutral-600" htmlFor="bootstrap-name">
          Nombre
        </label>
        <input
          id="bootstrap-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-neutral-600" htmlFor="bootstrap-business-type">
              businessTypeId
            </label>
            <input
              id="bootstrap-business-type"
              type="number"
              value={businessTypeId}
              onChange={(e) => setBusinessTypeId(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-600" htmlFor="bootstrap-jurisdiction">
              jurisdictionId
            </label>
            <input
              id="bootstrap-jurisdiction"
              type="number"
              value={jurisdictionId}
              onChange={(e) => setJurisdictionId(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={submitting}
          onClick={handleCreate}
          className="mt-3 w-full rounded border border-blue-600 px-3 py-2 text-sm font-medium text-blue-600 disabled:opacity-40"
        >
          Crear y continuar
        </button>
      </section>
    </main>
  );
}
