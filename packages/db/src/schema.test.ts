import { afterAll, describe, expect, it } from "vitest";
import { closePool } from "./pool.js";
import { withServiceSession, withUserSession } from "./session.js";

afterAll(async () => {
  await closePool();
});

async function createUser(email: string): Promise<string> {
  return withServiceSession(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO auth.users (email) VALUES ($1) RETURNING id",
      [email],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("user insert returned no id");
    return id;
  });
}

describe("extensions", () => {
  it("has PostGIS installed", async () => {
    const extensions = await withServiceSession(async (client) => {
      const { rows } = await client.query<{ extname: string }>(
        "SELECT extname FROM pg_extension WHERE extname = 'postgis'",
      );
      return rows;
    });
    expect(extensions).toHaveLength(1);
  });
});

describe("app.handle_new_user trigger", () => {
  it("creates exactly one personal organization per new user", async () => {
    const userId = await createUser(`trigger-${crypto.randomUUID()}@example.test`);

    const orgs = await withServiceSession(async (client) => {
      const { rows } = await client.query(
        "SELECT id, is_personal FROM app.organization WHERE owner_user_id = $1",
        [userId],
      );
      return rows;
    });

    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.is_personal).toBe(true);
  });

  it("rejects a second personal organization for the same user (unique index)", async () => {
    const userId = await createUser(`dup-org-${crypto.randomUUID()}@example.test`);

    await expect(
      withServiceSession((client) =>
        client.query(
          "INSERT INTO app.organization (owner_user_id, name, is_personal) VALUES ($1, 'Second', true)",
          [userId],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("RLS: app.project isolation", () => {
  async function createProjectFor(userId: string, name: string) {
    return withUserSession(userId, async (client) => {
      const org = await client.query<{ id: string }>(
        "SELECT id FROM app.organization WHERE owner_user_id = $1 AND is_personal",
        [userId],
      );
      const orgId = org.rows[0]?.id;
      if (!orgId) throw new Error("no personal org found");
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO app.project (owner_id, org_id, name) VALUES ($1, $2, $3) RETURNING id",
        [userId, orgId, name],
      );
      return rows[0]?.id;
    });
  }

  it("lets a user read their own project", async () => {
    const userId = await createUser(`owner-${crypto.randomUUID()}@example.test`);
    const projectId = await createProjectFor(userId, "Colmado La Esquina");

    const rows = await withUserSession(userId, async (client) => {
      const { rows } = await client.query("SELECT id FROM app.project WHERE id = $1", [
        projectId,
      ]);
      return rows;
    });

    expect(rows).toHaveLength(1);
  });

  it("hides one user's project from another user", async () => {
    const ownerId = await createUser(`isolated-owner-${crypto.randomUUID()}@example.test`);
    const otherId = await createUser(`isolated-other-${crypto.randomUUID()}@example.test`);
    const projectId = await createProjectFor(ownerId, "Ferreteria El Tornillo");

    const rowsSeenByOther = await withUserSession(otherId, async (client) => {
      const { rows } = await client.query("SELECT id FROM app.project WHERE id = $1", [
        projectId,
      ]);
      return rows;
    });

    expect(rowsSeenByOther).toHaveLength(0);
  });

  it("blocks a user from inserting a project owned by someone else", async () => {
    const ownerId = await createUser(`insert-victim-${crypto.randomUUID()}@example.test`);
    const attackerId = await createUser(`insert-attacker-${crypto.randomUUID()}@example.test`);

    const victimOrgId = await withServiceSession(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM app.organization WHERE owner_user_id = $1 AND is_personal",
        [ownerId],
      );
      return rows[0]?.id;
    });

    await expect(
      withUserSession(attackerId, (client) =>
        client.query("INSERT INTO app.project (owner_id, org_id, name) VALUES ($1, $2, $3)", [
          ownerId,
          victimOrgId,
          "Spoofed project",
        ]),
      ),
    ).rejects.toThrow();
  });

  it("hides a project's location (child table) from a non-owner", async () => {
    const ownerId = await createUser(`child-owner-${crypto.randomUUID()}@example.test`);
    const otherId = await createUser(`child-other-${crypto.randomUUID()}@example.test`);
    const projectId = await createProjectFor(ownerId, "Salon Bella Vista");

    await withUserSession(ownerId, (client) =>
      client.query(
        `INSERT INTO app.project_location
           (project_id, centroid, area_source)
         VALUES ($1, ST_SetSRID(ST_MakePoint(-69.9312, 18.4861), 4326), 'user_entered')`,
        [projectId],
      ),
    );

    const seenByOther = await withUserSession(otherId, async (client) => {
      const { rows } = await client.query(
        "SELECT project_id FROM app.project_location WHERE project_id = $1",
        [projectId],
      );
      return rows;
    });

    expect(seenByOther).toHaveLength(0);
  });
});

describe("app.report disclaimer CHECK constraint", () => {
  it("rejects a report marked ready without a disclaimer and storage key", async () => {
    const userId = await createUser(`report-${crypto.randomUUID()}@example.test`);

    await expect(
      withUserSession(userId, async (client) => {
        const org = await client.query<{ id: string }>(
          "SELECT id FROM app.organization WHERE owner_user_id = $1 AND is_personal",
          [userId],
        );
        const orgId = org.rows[0]?.id;
        const project = await client.query<{ id: string }>(
          "INSERT INTO app.project (owner_id, org_id, name) VALUES ($1, $2, 'Minimarket Prueba') RETURNING id",
          [userId, orgId],
        );
        const projectId = project.rows[0]?.id;
        await client.query(
          `INSERT INTO app.report (project_id, requested_by, status)
           VALUES ($1, $2, 'ready')`,
          [projectId, userId],
        );
      }),
    ).rejects.toThrow();
  });
});
