import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { AuditLogEntry, EnvironmentSummary } from "@iwifunni/contracts";

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

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

interface Fixture {
  session: TestSession;
  organizationId: string;
  projectKey: string;
  projectId: string;
}

async function createProject(
  session: TestSession,
  name = "Checkout Platform",
): Promise<{ id: string; key: string }> {
  const response = await app.request("/v1/projects", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ name }),
  });

  expect(response.status).toBe(201);

  return (await response.json()) as { id: string; key: string };
}

async function fixture(): Promise<Fixture> {
  const session = await signUp(app);
  const workspace = await seedWorkspace(session.userId, "owner");
  const project = await createProject(session);

  return {
    session,
    organizationId: workspace.organizationId,
    projectKey: project.key,
    projectId: project.id,
  };
}

async function pageOf(
  path: string,
  session: TestSession,
): Promise<{ data: AuditLogEntry[]; nextCursor: string | null }> {
  const response = await app.request(path, {
    headers: { cookie: session.cookie },
  });

  expect(response.status).toBe(200);

  return (await response.json()) as {
    data: AuditLogEntry[];
    nextCursor: string | null;
  };
}

describe("audit log module", () => {
  it("lists one project's history newest first", async () => {
    const underTest = await fixture();

    await tick();
    await app.request(`/v1/projects/${underTest.projectKey}/flags`, {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({
        key: "checkout-v2",
        name: "Checkout",
        type: "boolean",
      }),
    });
    await tick();
    await app.request(
      `/v1/projects/${underTest.projectKey}/environments`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({ name: "Staging", key: "staging" }),
      },
    );

    const body = await pageOf(
      `/v1/projects/${underTest.projectKey}/audit-logs`,
      underTest.session,
    );

    expect(body.data.map((entry) => entry.action)).toEqual([
      "environment.created",
      "flag.created",
      "project.created",
    ]);
    expect(body.data[0]?.projectId).toBe(underTest.projectId);
    expect(body.data[0]?.projectKey).toBe(underTest.projectKey);
    expect(body.nextCursor).toBeNull();
  });

  it("keeps projects apart and spans them in the workspace list", async () => {
    const underTest = await fixture();
    const second = await createProject(underTest.session, "Second");

    const scoped = await pageOf(
      `/v1/projects/${underTest.projectKey}/audit-logs`,
      underTest.session,
    );
    expect(scoped.data).toHaveLength(1);
    expect(scoped.data[0]?.projectId).toBe(underTest.projectId);

    const workspace = await pageOf("/v1/audit-logs", underTest.session);
    expect(workspace.data).toHaveLength(2);
    expect(
      workspace.data.map((entry) => entry.projectKey).sort(),
    ).toEqual([underTest.projectKey, second.key].sort());
  });

  it("filters by action, actor and environment, and rejects a bad timestamp", async () => {
    const underTest = await fixture();

    await app.request(`/v1/projects/${underTest.projectKey}/flags`, {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({
        key: "checkout-v2",
        name: "Checkout",
        type: "boolean",
      }),
    });

    // A flag's identity is project-wide, so only a configuration publish is
    // scoped to one environment and carries its id.
    await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/environments/development`,
      {
        method: "PATCH",
        headers: headers(underTest.session),
        body: JSON.stringify({
          enabled: true,
          offVariation: "off",
          defaultVariation: "on",
          rolloutPercentage: 0,
          bucketBy: "userId",
        }),
      },
    );

    const environments = await pageOf("/v1/audit-logs", underTest.session).then(
      () =>
        app.request(`/v1/projects/${underTest.projectKey}/environments`, {
          headers: { cookie: underTest.session.cookie },
        }),
    );
    const environmentList = (await environments.json()) as {
      data: EnvironmentSummary[];
    };
    const environmentId = environmentList.data[0]?.id ?? "";

    const byAction = await pageOf(
      `/v1/projects/${underTest.projectKey}/audit-logs?action=flag.created`,
      underTest.session,
    );
    expect(byAction.data).toHaveLength(1);
    expect(byAction.data[0]?.action).toBe("flag.created");

    const byActor = await pageOf(
      `/v1/projects/${underTest.projectKey}/audit-logs?actor=${underTest.session.userId}`,
      underTest.session,
    );
    expect(byActor.data).toHaveLength(3);

    const byEnvironment = await pageOf(
      `/v1/projects/${underTest.projectKey}/audit-logs?environmentId=${environmentId}`,
      underTest.session,
    );
    expect(byEnvironment.data).toHaveLength(1);
    expect(byEnvironment.data[0]?.action).toBe("flag.enabled");

    const bad = await app.request(
      `/v1/projects/${underTest.projectKey}/audit-logs?from=not-a-date`,
      { headers: { cookie: underTest.session.cookie } },
    );
    expect(bad.status).toBe(400);
  });

  it("pages without repeating or skipping a row", async () => {
    const underTest = await fixture();

    for (const key of ["alpha", "beta", "gamma"]) {
      await tick();
      await app.request(`/v1/projects/${underTest.projectKey}/flags`, {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({
          key,
          name: key,
          type: "boolean",
        }),
      });
    }

    const first = await pageOf(
      `/v1/projects/${underTest.projectKey}/audit-logs?limit=2`,
      underTest.session,
    );

    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await pageOf(
      `/v1/projects/${underTest.projectKey}/audit-logs?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
      underTest.session,
    );

    expect(second.data).toHaveLength(2);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.data, ...second.data].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("lets a viewer read the history and hides other workspaces", async () => {
    const underTest = await fixture();
    const { db } = await import("../../db/client.js");
    const { member, projectMember } = await import("../../db/schema/index.js");

    const viewer = await signUp(app);
    await db.insert(member).values({
      id: randomUUID(),
      organizationId: underTest.organizationId,
      userId: viewer.userId,
      role: "member",
    });
    await db.insert(projectMember).values({
      id: randomUUID(),
      projectId: underTest.projectId,
      userId: viewer.userId,
      role: "viewer",
    });

    const read = await pageOf(
      `/v1/projects/${underTest.projectKey}/audit-logs`,
      viewer,
    );
    expect(read.data).toHaveLength(1);

    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");

    const foreign = await app.request(
      `/v1/projects/${underTest.projectKey}/audit-logs`,
      { headers: { cookie: outsider.cookie } },
    );
    expect(foreign.status).toBe(404);

    const foreignWorkspace = await pageOf("/v1/audit-logs", outsider);
    expect(foreignWorkspace.data).toHaveLength(0);
  });

  it("snapshots the actor's name, so a later rename does not rewrite the row", async () => {
    const session = await signUp(app, "Ada Lovelace");
    await seedWorkspace(session.userId, "owner");
    const project = await createProject(session);

    await app.request(`/v1/projects/${project.key}/flags`, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        key: "checkout-v2",
        name: "Checkout",
        type: "boolean",
      }),
    });

    const before = await pageOf(
      `/v1/projects/${project.key}/audit-logs?action=flag.created`,
      session,
    );
    expect(before.data[0]?.actor).toBe(session.userId);
    expect(before.data[0]?.actorName).toBe("Ada Lovelace");

    const renamed = await app.request("/v1/me", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({ name: "Ada Byron", email: session.email }),
    });
    expect(renamed.status).toBe(200);

    const after = await pageOf(
      `/v1/projects/${project.key}/audit-logs?action=flag.created`,
      session,
    );
    expect(after.data[0]?.actorName).toBe("Ada Lovelace");
  });
});
