import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Project } from "@iwifunni/contracts";

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

async function owner(): Promise<{ session: TestSession; organizationId: string }> {
  const session = await signUp(app);
  const workspace = await seedWorkspace(session.userId, "owner");

  return { session, organizationId: workspace.organizationId };
}

async function createProject(
  session: TestSession,
  name: string,
): Promise<Project> {
  const response = await app.request("/v1/projects", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ name }),
  });

  expect(response.status).toBe(201);

  return (await response.json()) as Project;
}

describe("projects read and update", () => {
  it("refuses a retired create field rather than ignoring it", async () => {
    const { session } = await owner();

    const response = await app.request("/v1/projects", {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        name: "Checkout Platform",
        environmentName: "Production",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
    });
  });

  it("lists projects with their environment count and searches", async () => {
    const { session } = await owner();
    await createProject(session, "Alpha Platform");
    await createProject(session, "Beta Service");

    const list = await app.request("/v1/projects", {
      headers: { cookie: session.cookie },
    });

    expect(list.status).toBe(200);
    const body = (await list.json()) as Project[];

    expect(body.map((project) => project.key)).toEqual([
      "alpha-platform",
      "beta-service",
    ]);
    expect(body[0]).toMatchObject({ environmentCount: 2 });

    const searched = await app.request("/v1/projects?search=beta", {
      headers: { cookie: session.cookie },
    });
    const filtered = (await searched.json()) as Project[];

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.key).toBe("beta-service");
  });

  it("returns one project by key", async () => {
    const { session } = await owner();
    const project = await createProject(session, "Alpha Platform");

    const response = await app.request(`/v1/projects/${project.key}`, {
      headers: { cookie: session.cookie },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      key: "alpha-platform",
      name: "Alpha Platform",
      environmentCount: 2,
    });
  });

  it("renames a project, sets its default environment and audits the change", async () => {
    const { session } = await owner();
    const project = await createProject(session, "Alpha Platform");

    const renamed = await app.request(`/v1/projects/${project.key}`, {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({
        name: "Alpha v2",
        description: "Renamed",
        color: "#ff0000",
        defaultEnvironmentKey: "development",
      }),
    });

    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({
      name: "Alpha v2",
      description: "Renamed",
      color: "#ff0000",
    });

    const { db } = await import("../../db/client.js");
    const { auditLog, project: projectTable } = await import(
      "../../db/schema/index.js"
    );
    const [row] = await db.select().from(projectTable);

    expect(row?.name).toBe("Alpha v2");
    expect(row?.defaultEnvironmentId).not.toBeNull();

    const actions = (await db.select().from(auditLog)).map((entry) => entry.action);
    expect(actions.filter((action) => action === "project.updated")).toHaveLength(
      1,
    );
  });

  it("refuses an unknown default environment and a non-owner", async () => {
    const { session, organizationId } = await owner();
    const project = await createProject(session, "Alpha Platform");

    const unknown = await app.request(`/v1/projects/${project.key}`, {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({ defaultEnvironmentKey: "nope" }),
    });
    expect(unknown.status).toBe(400);

    const engineer = await signUp(app);
    const { db } = await import("../../db/client.js");
    const { member, projectMember } = await import("../../db/schema/index.js");

    await db.insert(member).values({
      id: randomUUID(),
      organizationId,
      userId: engineer.userId,
      role: "member",
    });
    await db.insert(projectMember).values({
      id: randomUUID(),
      projectId: project.id,
      userId: engineer.userId,
      role: "engineer",
    });

    const refused = await app.request(`/v1/projects/${project.key}`, {
      method: "PATCH",
      headers: headers(engineer),
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(refused.status).toBe(403);

    // Reading is still allowed for a project member.
    const readable = await app.request(`/v1/projects/${project.key}`, {
      headers: { cookie: engineer.cookie },
    });
    expect(readable.status).toBe(200);
  });

  it("hides another workspace's projects", async () => {
    const { session } = await owner();
    const project = await createProject(session, "Alpha Platform");

    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");

    const list = await app.request("/v1/projects", {
      headers: { cookie: outsider.cookie },
    });
    await expect(list.json()).resolves.toEqual([]);

    const detail = await app.request(`/v1/projects/${project.key}`, {
      headers: { cookie: outsider.cookie },
    });
    expect(detail.status).toBe(404);
  });
});
