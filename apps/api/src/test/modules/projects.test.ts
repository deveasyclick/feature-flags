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

async function owner(): Promise<{
  session: TestSession;
  organizationId: string;
}> {
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
  it("archives and restores data while keeping old keys revoked and schedules cancelled", async () => {
    const { session } = await owner();
    const project = await createProject(session, "Lifecycle");
    const root = `/v1/projects/${project.key}`;
    expect(
      (
        await app.request(`${root}/flags`, {
          method: "POST",
          headers: headers(session),
          body: JSON.stringify({
            key: "banner",
            name: "Banner",
            type: "boolean",
          }),
        })
      ).status,
    ).toBe(201);
    const issued = await app.request(`${root}/api-keys`, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        name: "Runtime",
        kind: "server",
        environmentKey: "development",
      }),
    });
    const key = (await issued.json()) as { secret: string };
    expect(issued.status).toBe(201);
    const scheduled = await app.request(
      `${root}/flags/banner/environments/development/schedules`,
      {
        method: "POST",
        headers: headers(session),
        body: JSON.stringify({
          executeAt: new Date(Date.now() + 120_000).toISOString(),
          baseVersion: 1,
          payload: {
            targets: { targets: [{ userId: "tester", variationKey: "on" }] },
          },
        }),
      },
    );
    expect(scheduled.status).toBe(201);
    expect(
      (
        await app.request(`${root}/archive`, {
          method: "POST",
          headers: headers(session),
        })
      ).status,
    ).toBe(204);
    expect(
      await (
        await app.request("/v1/projects", { headers: headers(session) })
      ).json(),
    ).toEqual([]);
    const archived = await app.request("/v1/projects?includeArchived=true", {
      headers: headers(session),
    });
    await expect(archived.json()).resolves.toMatchObject([
      { key: project.key, archivedAt: expect.any(String) },
    ]);
    expect(
      (await app.request(`${root}/flags`, { headers: headers(session) }))
        .status,
    ).toBe(404);
    expect(
      (
        await app.request("/v1/sdk/config", {
          headers: { authorization: `Bearer ${key.secret}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(`${root}/restore`, {
          method: "POST",
          headers: headers(session),
        })
      ).status,
    ).toBe(200);
    expect(
      (await app.request(`${root}/flags/banner`, { headers: headers(session) }))
        .status,
    ).toBe(200);
    expect(
      (
        await app.request("/v1/sdk/config", {
          headers: { authorization: `Bearer ${key.secret}` },
        })
      ).status,
    ).toBe(401);
    const schedules = await app.request(
      `${root}/flags/banner/environments/development/schedules`,
      { headers: headers(session) },
    );
    await expect(schedules.json()).resolves.toMatchObject({
      data: [{ status: "cancelled" }],
    });
  });

  it("duplicates targeting with independent identities, disabled flags and no credentials", async () => {
    const { session } = await owner();
    const source = await createProject(session, "Original");
    const root = `/v1/projects/${source.key}`;
    await app.request(`${root}/segments`, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        key: "beta",
        name: "Beta",
        rules: [
          {
            attribute: "country",
            attributeType: "string",
            operator: "equals",
            values: ["NG"],
          },
        ],
      }),
    });
    await app.request(`${root}/flags`, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({ key: "banner", name: "Banner", type: "boolean" }),
    });
    const config = {
      enabled: true,
      offVariation: "off",
      defaultVariation: "on",
      rolloutPercentage: 40,
      bucketBy: "userId",
    };
    expect(
      (
        await app.request(
          `${root}/flags/banner/environments/development/targeting`,
          {
            method: "PUT",
            headers: headers(session),
            body: JSON.stringify({
              config,
              rules: [
                { variation: "on", segmentKeys: ["beta"], conditions: [] },
              ],
              targets: [{ userId: "tester", variationKey: "on" }],
            }),
          },
        )
      ).status,
    ).toBe(200);
    const copied = await app.request(`${root}/duplicate`, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({ name: "Independent copy" }),
    });
    expect(copied.status).toBe(201);
    const copy = (await copied.json()) as { id: string; key: string };
    expect(copy.id).not.toBe(source.id);
    const copiedRoot = `/v1/projects/${copy.key}`;
    const read = await app.request(
      `${copiedRoot}/flags/banner/environments/development`,
      { headers: headers(session) },
    );
    await expect(read.json()).resolves.toMatchObject({
      enabled: false,
      rolloutPercentage: 40,
      rules: [{ segmentKeys: ["beta"] }],
      individualTargets: [{ userId: "tester", variationKey: "on" }],
    });
    const release = await app.request(
      `${copiedRoot}/flags/banner/environments/development/versions/1`,
      { headers: headers(session) },
    );
    await expect(release.json()).resolves.toMatchObject({
      state: {
        config: { enabled: false },
        rules: { rules: [{ segmentKeys: ["beta"] }] },
      },
    });
    const keys = await app.request(`${copiedRoot}/api-keys`, {
      headers: headers(session),
    });
    await expect(keys.json()).resolves.toMatchObject({ data: [] });
    const visibility = await app.request(
      `${copiedRoot}/flags/banner/client-visibility`,
      { headers: headers(session) },
    );
    expect(await visibility.json()).toEqual({ clientVisible: false });
  });

  it("requires ownership of both transfer workspaces and resolves the selected workspace", async () => {
    const { session } = await owner();
    const source = await createProject(session, "Transfer me");
    const stranger = await signUp(app);
    const foreign = await seedWorkspace(stranger.userId, "owner");
    const path = `/v1/projects/${source.key}/transfer`;
    const denied = await app.request(path, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({ destinationWorkspaceSlug: foreign.slug }),
    });
    expect(denied.status).toBe(404);
    const destination = await seedWorkspace(session.userId, "owner");
    const moved = await app.request(path, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({ destinationWorkspaceSlug: destination.slug }),
    });
    expect(moved.status).toBe(201);
    const copy = (await moved.json()) as { id: string; key: string };
    const original = await app.request(`/v1/projects/${source.key}`, {
      headers: headers(session),
    });
    await expect(original.json()).resolves.toMatchObject({
      id: source.id,
      archivedAt: expect.any(String),
    });
    const active = await app.request("/api/auth/organization/set-active", {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({ organizationId: destination.organizationId }),
    });
    expect(active.status).toBe(200);
    const me = await app.request("/v1/me", { headers: headers(session) });
    await expect(me.json()).resolves.toMatchObject({
      workspace: { id: destination.organizationId },
    });
    const target = await app.request(`/v1/projects/${copy.key}`, {
      headers: headers(session),
    });
    await expect(target.json()).resolves.toMatchObject({
      id: copy.id,
      archivedAt: null,
    });
    const readForeign = await app.request(`/v1/projects/${copy.key}`, {
      headers: headers(stranger),
    });
    expect(readForeign.status).toBe(404);
  });

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

    const actions = (await db.select().from(auditLog)).map(
      (entry) => entry.action,
    );
    expect(
      actions.filter((action) => action === "project.updated"),
    ).toHaveLength(1);
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

  it("keeps notification read state private and enforces workspace isolation", async () => {
    const { session } = await owner();
    const project = await createProject(session, "Notifications");
    await app.request(`/v1/projects/${project.key}/archive`, {
      method: "POST",
      headers: headers(session),
    });
    const inbox = await app.request("/v1/notifications?limit=1", {
      headers: headers(session),
    });
    expect(inbox.status).toBe(200);
    const page = (await inbox.json()) as {
      data: Array<{ id: string; read: boolean }>;
      unreadCount: number;
    };
    expect(page.unreadCount).toBe(1);
    expect(page.data[0]?.read).toBe(false);
    await app.request("/v1/me/notifications", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({
        flagChanges: false,
        weeklyDigest: false,
        incidentAlerts: true,
      }),
    });
    const muted = await app.request("/v1/notifications", {
      headers: headers(session),
    });
    await expect(muted.json()).resolves.toMatchObject({
      data: [],
      unreadCount: 0,
    });
    await app.request("/v1/me/notifications", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({
        flagChanges: true,
        weeklyDigest: false,
        incidentAlerts: true,
      }),
    });
    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");
    const id = page.data[0]?.id;
    expect(
      (
        await app.request(`/v1/notifications/${id}/read`, {
          method: "POST",
          headers: headers(outsider),
        })
      ).status,
    ).toBe(404);
    const hidden = await app.request("/v1/notifications", {
      headers: headers(outsider),
    });
    await expect(hidden.json()).resolves.toMatchObject({
      data: [],
      unreadCount: 0,
    });
    expect(
      (
        await app.request(`/v1/notifications/${id}/read`, {
          method: "POST",
          headers: headers(session),
        })
      ).status,
    ).toBe(204);
    const read = await app.request("/v1/notifications", {
      headers: headers(session),
    });
    await expect(read.json()).resolves.toMatchObject({
      data: [{ id, read: true }],
      unreadCount: 0,
    });
  });
});
