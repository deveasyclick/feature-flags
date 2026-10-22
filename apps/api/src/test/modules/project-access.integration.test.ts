import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  closeTestDatabase,
  loadApp,
  loadTestEnv,
  resetTestDatabase,
  seedWorkspace,
  signUp,
  truncateAll,
  type TestSession,
} from "../harness.js";

/**
 * Integration coverage for the authorization gate itself, against real rows and
 * through real routes, rather than the fabricated repository the unit test uses.
 */

let app: Awaited<ReturnType<typeof loadApp>>;

beforeAll(async () => {
  loadTestEnv();
  await resetTestDatabase();
  app = await loadApp();
});

afterEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

function headers(session: TestSession): Record<string, string> {
  return { "content-type": "application/json", cookie: session.cookie };
}

interface Fixture {
  session: TestSession;
  organizationId: string;
  projectKey: string;
  projectId: string;
}

async function fixture(): Promise<Fixture> {
  const session = await signUp(app);
  const workspace = await seedWorkspace(session.userId, "owner");

  const created = await app.request("/v1/projects", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ name: "Checkout Platform" }),
  });
  const project = (await created.json()) as { id: string; key: string };

  return {
    session,
    organizationId: workspace.organizationId,
    projectKey: project.key,
    projectId: project.id,
  };
}

/** A second person in the workspace, with an optional project role row. */
async function person(
  underTest: Fixture,
  workspaceRole: string,
  projectRole?: string,
): Promise<TestSession> {
  const session = await signUp(app);
  const { db } = await import("../../db/client.js");
  const { member, projectMember } = await import("../../db/schema/index.js");

  await db.insert(member).values({
    id: randomUUID(),
    organizationId: underTest.organizationId,
    userId: session.userId,
    role: workspaceRole,
  });

  if (projectRole) {
    await db.insert(projectMember).values({
      id: randomUUID(),
      projectId: underTest.projectId,
      userId: session.userId,
      role: projectRole,
    });
  }

  return session;
}

async function setProjectRole(
  projectId: string,
  userId: string,
  role: string,
): Promise<void> {
  const { db } = await import("../../db/client.js");
  const { projectMember } = await import("../../db/schema/index.js");
  const { and, eq } = await import("drizzle-orm");

  await db
    .update(projectMember)
    .set({ role })
    .where(
      and(
        eq(projectMember.projectId, projectId),
        eq(projectMember.userId, userId),
      ),
    );
}

function readFlags(session: TestSession, projectKey: string) {
  return app.request(
    `/v1/projects/${projectKey}/flags?environmentKey=development`,
    {
      headers: { cookie: session.cookie },
    },
  );
}

function createFlag(session: TestSession, projectKey: string, key: string) {
  return app.request(`/v1/projects/${projectKey}/flags`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({
      key,
      name: key,
      type: "boolean",
    }),
  });
}

describe("project access gate", () => {
  it("hides project data from workspace-wide reads and evaluation after project access is removed", async () => {
    const underTest = await fixture();
    const created = await createFlag(
      underTest.session,
      underTest.projectKey,
      "private-feature",
    );
    expect(created.status).toBe(201);
    const outsider = await person(underTest, "member", "viewer");
    expect((await readFlags(outsider, underTest.projectKey)).status).toBe(200);
    const { db } = await import("../../db/client.js");
    const { projectMember } = await import("../../db/schema/index.js");
    const { and, eq } = await import("drizzle-orm");
    await db
      .delete(projectMember)
      .where(
        and(
          eq(projectMember.projectId, underTest.projectId),
          eq(projectMember.userId, outsider.userId),
        ),
      );
    for (const path of ["/v1/projects", "/v1/flags", "/v1/audit-logs"]) {
      const response = await app.request(path, { headers: headers(outsider) });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(JSON.stringify(body)).not.toContain(underTest.projectKey);
      expect(JSON.stringify(body)).not.toContain("private-feature");
    }
    const evaluated = await app.request("/v1/evaluate", {
      method: "POST",
      headers: headers(outsider),
      body: JSON.stringify({
        projectKey: underTest.projectKey,
        flag: "private-feature",
        environment: "development",
        user: { id: "u1" },
      }),
    });
    await expect(evaluated.json()).resolves.toMatchObject({
      reason: "flag_not_found",
    });
  });

  it("lets a workspace owner in without any project membership row", async () => {
    const underTest = await fixture();

    const response = await readFlags(underTest.session, underTest.projectKey);
    expect(response.status).toBe(200);

    const { db } = await import("../../db/client.js");
    const { projectMember } = await import("../../db/schema/index.js");
    const rows = await db.select().from(projectMember);

    // The creator does have an owner row, but the gate does not depend on it:
    // the workspace role alone grants access.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(underTest.session.userId);
  });

  it("treats a workspace admin as an implicit project admin", async () => {
    const underTest = await fixture();
    const admin = await person(underTest, "admin");

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/environments`,
      {
        method: "POST",
        headers: headers(admin),
        body: JSON.stringify({ name: "Staging", key: "staging" }),
      },
    );

    // Admin-level write, with no project_members row for this user.
    expect(response.status).toBe(201);
  });

  it("answers a workspace member with no project row with 404", async () => {
    const underTest = await fixture();
    const colleague = await person(underTest, "member");

    const read = await readFlags(colleague, underTest.projectKey);
    const write = await createFlag(colleague, underTest.projectKey, "beta");

    expect(read.status).toBe(404);
    expect(write.status).toBe(404);
  });

  it("separates read from write by the explicit project role", async () => {
    const underTest = await fixture();
    const viewer = await person(underTest, "member", "viewer");

    expect((await readFlags(viewer, underTest.projectKey)).status).toBe(200);
    expect(
      (await createFlag(viewer, underTest.projectKey, "beta")).status,
    ).toBe(403);
  });

  it("ignores a stored role it does not recognise", async () => {
    const underTest = await fixture();
    const stranger = await person(underTest, "member", "superuser");

    const response = await readFlags(stranger, underTest.projectKey);

    // Not granted anything: an unknown role is a non-member.
    expect(response.status).toBe(404);
  });

  it("applies a role change on the very next request", async () => {
    const underTest = await fixture();
    const colleague = await person(underTest, "member", "viewer");

    expect(
      (await createFlag(colleague, underTest.projectKey, "beta")).status,
    ).toBe(403);

    await setProjectRole(underTest.projectId, colleague.userId, "engineer");

    // Membership is resolved per request, never carried in the session.
    expect(
      (await createFlag(colleague, underTest.projectKey, "beta")).status,
    ).toBe(201);
  });

  it("revokes access as soon as the membership row goes", async () => {
    const underTest = await fixture();
    const colleague = await person(underTest, "member", "engineer");
    const { db } = await import("../../db/client.js");
    const { projectMember } = await import("../../db/schema/index.js");
    const { and, eq } = await import("drizzle-orm");

    expect(
      (await createFlag(colleague, underTest.projectKey, "beta")).status,
    ).toBe(201);

    await db
      .delete(projectMember)
      .where(
        and(
          eq(projectMember.projectId, underTest.projectId),
          eq(projectMember.userId, colleague.userId),
        ),
      );

    expect((await readFlags(colleague, underTest.projectKey)).status).toBe(404);
  });

  it("hides the project from another workspace", async () => {
    const underTest = await fixture();
    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");

    const response = await readFlags(outsider, underTest.projectKey);

    expect(response.status).toBe(404);
  });
});
