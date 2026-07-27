# `@sodeja/db` — Database Access & Migrations

Local Postgres+PostGIS (`docker-compose.yml` at the repo root) migrated via
[node-pg-migrate](https://github.com/salsita/node-pg-migrate), generated from
the approved spec at [`specs/db/schema.sql`](../../specs/db/schema.sql).

## Local vs. Supabase auth

[`SODEJA_ARCHITECTURE.md`](../../docs/SODEJA_ARCHITECTURE.md) allows either
Supabase Auth or a local equivalent. This package builds the **local**
equivalent only (`auth.users` + a `auth.uid()` stub reading the
`request.jwt.claim.sub` session GUC) so nothing here depends on a hosted
account. Every RLS policy is written against `auth.uid()`, so swapping in real
Supabase later is a connection-string and identity-provider change, not a
schema or policy rewrite.

## Usage

```ts
import { withUserSession, withServiceSession } from "@sodeja/db";

// Request path: RLS-scoped to one user, mirrors a PostgREST/Supabase request.
await withUserSession(userId, async (client) => {
  const { rows } = await client.query("SELECT * FROM app.project");
  return rows; // only this user's (and their org's) projects
});

// Migrations, ingestion jobs: runs as the connecting role, bypasses RLS.
await withServiceSession(async (client) => {
  await client.query("INSERT INTO geo.building_footprint (...) VALUES (...)");
});
```

## Commands

| Command | Effect |
|---|---|
| `pnpm --filter @sodeja/db migrate:up` | Apply pending migrations to `DATABASE_URL` |
| `pnpm --filter @sodeja/db migrate:down` | Roll back the last migration |
| `pnpm --filter @sodeja/db migrate:create <name>` | Scaffold a new `.sql` migration |

Requires `DATABASE_URL` (see `.env.example` at the repo root) and the local
container running: `docker compose up -d`.

## Related backlog items

B-2 (Postgres, PostGIS, RLS, Supabase Auth, project aggregate).
