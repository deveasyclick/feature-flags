import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ProjectMember } from "@iwifunni/contracts";

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
}

async function fixture(): Promise<Fixture> {
  const session = await signUp(app);
  const workspace = await seedWorkspace(session.userId, "owner");

  const created = await app.request("/v1/projects", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ name: "Checkout Platform" }),
  });
  const project = (await created.json()) as { key: string };

  return {
    session,
    organizationId: workspace.organizationId,
    projectKey: project.key,
  };
}

/** A second person who belongs to the same workspace. */
async function workspaceColleague(
  organizationId: string,
  role = "member",
): Promise<TestSession> {
  const session = await signUp(app, "Colleague");
  const { db } = await import("../../db/client.js");
  const { member } = await import("../../db/schema/index.js");

  await db.insert(member).values({
    id: randomUUID(),
    organizationId,
    userId: session.userId,
    role,
  });

  return session;
}

describe("project members module", () => {
  it("lists the creator as the project owner", async () => {
    const underTest = await fixture();

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/members`,
      { headers: { cookie: underTest.session.cookie } },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as ProjectMember[];

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      userId: underTest.session.userId,
      role: "owner",
      email: underTest.session.email,
    });
  });

  it("adds, re-roles and removes a workspace colleague", async () => {
    const underTest = await fixture();
    const colleague = await workspaceColleague(underTest.organizationId);

    const added = await app.request(
      `/v1/projects/${underTest.projectKey}/members`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({ userId: colleague.userId, role: "engineer" }),
      },
    );

    expect(added.status).toBe(201);
    await expect(added.json()).resolves.toMatchObject({
      userId: colleague.userId,
      role: "engineer",
    });

    const duplicate = await app.request(
      `/v1/projects/${underTest.projectKey}/members`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({ userId: colleague.userId, role: "viewer" }),
      },
    );
    expect(duplicate.status).toBe(409);

    const updated = await app.request(
      `/v1/projects/${underTest.projectKey}/members/${colleague.userId}`,
      {
        method: "PATCH",
        headers: headers(underTest.session),
        body: JSON.stringify({ role: "viewer" }),
      },
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ role: "viewer" });

    const removed = await app.request(
      `/v1/projects/${underTest.projectKey}/members/${colleague.userId}`,
      { method: "DELETE", headers: { cookie: underTest.session.cookie } },
    );
    expect(removed.status).toBe(200);

    // A second removal is a 404, not a silent success.
    const again = await app.request(
      `/v1/projects/${underTest.projectKey}/members/${colleague.userId}`,
      { method: "DELETE", headers: { cookie: underTest.session.cookie } },
    );
    expect(again.status).toBe(404);

    const { db } = await import("../../db/client.js");
    const { auditLog } = await import("../../db/schema/index.js");
    const actions = (await db.select().from(auditLog)).map((row) => row.action);

    expect(
      actions.filter((action) => action.startsWith("project_member.")).sort(),
    ).toEqual([
      "project_member.added",
      "project_member.removed",
      "project_member.updated",
    ]);
  });

  it("refuses somebody who is not in the workspace", async () => {
    const underTest = await fixture();
    const stranger = await signUp(app);

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/members`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({ userId: stranger.userId, role: "viewer" }),
      },
    );

    expect(response.status).toBe(400);
  });

  it("lets a viewer read the roster but not manage it", async () => {
    const underTest = await fixture();
    const viewer = await workspaceColleague(underTest.organizationId);
    const target = await workspaceColleague(underTest.organizationId);

    await app.request(`/v1/projects/${underTest.projectKey}/members`, {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({ userId: viewer.userId, role: "viewer" }),
    });

    const read = await app.request(
      `/v1/projects/${underTest.projectKey}/members`,
      { headers: { cookie: viewer.cookie } },
    );
    expect(read.status).toBe(200);

    const write = await app.request(
      `/v1/projects/${underTest.projectKey}/members`,
      {
        method: "POST",
        headers: headers(viewer),
        body: JSON.stringify({ userId: target.userId, role: "viewer" }),
      },
    );
    expect(write.status).toBe(403);

    const remove = await app.request(
      `/v1/projects/${underTest.projectKey}/members/${viewer.userId}`,
      { method: "DELETE", headers: { cookie: viewer.cookie } },
    );
    expect(remove.status).toBe(403);
  });

  it("hides another workspace's roster", async () => {
    const underTest = await fixture();
    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/members`,
      { headers: { cookie: outsider.cookie } },
    );

    expect(response.status).toBe(404);
  });
});
