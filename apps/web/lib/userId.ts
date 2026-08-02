const STORAGE_KEY = "sodeja:dev-user-id";

/**
 * TEMPORARY AUTH PLACEHOLDER — mirrors apps/api/src/common/current-user-id.
 * decorator.ts's own placeholder comment: no `auth` module exists on either
 * side yet (Supabase JWT verification is a separate, unbuilt backlog item).
 * A random UUID is generated once per browser and persisted in
 * localStorage, then sent as `x-user-id` on every request in lib/apiClient.
 * ts. This is NOT an authorization boundary — Postgres RLS
 * (SODEJA_ARCHITECTURE.md "Auth & data access") is — it exists only so B-7's
 * flow is testable end-to-end before the real auth module lands.
 */
export function getDevUserId(): string {
  if (typeof window === "undefined") {
    // Server-render/build time: no localStorage. Every call site in this
    // app only needs a user id for a browser-initiated API call, so this
    // path is never actually exercised — see lib/apiClient.ts.
    return "";
  }
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  window.localStorage.setItem(STORAGE_KEY, generated);
  return generated;
}
