import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type {
  AuditLogEntry,
  EvaluationResult,
  FlagSummary,
  ProjectMember,
} from "@iwifunni/contracts";

import {
  closeTestDatabase,
  loadApp,
  loadTestEnv,
  resetTestDatabase,
  seedWorkspace,
  signUp,
  truncateAll,
  type TestSession,
} from "./harness.js";

/**
 * Acceptance suite: the end-to-end claims the increment makes, exercised through
 * the real app rather than through a module's own service.
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

interface Workspace {
  session: TestSession;
  organizationId: string;
  projectKey: string;
  projectId: string;
}

async function workspaceWithProject(name = "Checkout Platform"): Promise<Workspace> {
  const session = await signUp(app);
  const workspace = await seedWorkspace(session.userId, "owner");

  const created = await app.request("/v1/projects", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ name }),
  });
  expect(created.status).toBe(201);
  const project = (await created.json()) as { id: string; key: string };

  return {
    session,
    organizationId: workspace.organizationId,
    projectKey: project.key,
    projectId: project.id,
  };
}

/** A person with a workspace role and optionally a project role. */
async function person(
  workspace: Workspace,
  workspaceRole: string,
  projectRole?: string,
): Promise<TestSession> {
  const session = await signUp(app);
  const { db } = await import("../db/client.js");
  const { member, projectMember } = await import("../db/schema/index.js");

  await db.insert(member).values({
    id: randomUUID(),
    organizationId: workspace.organizationId,
    userId: session.userId,
    role: workspaceRole,
  });

  if (projectRole) {
    await db.insert(projectMember).values({
      id: randomUUID(),
      projectId: workspace.projectId,
      userId: session.userId,
      role: projectRole,
    });
  }

  return session;
}

describe("acceptance: health", () => {
  it("serves /healthz and /readyz against a migrated but empty database", async () => {
    const healthy = await app.request("/healthz");
    expect(healthy.status).toBe(200);

    const ready = await app.request("/readyz");
    const body = (await ready.json()) as {
      status: string;
      checks: Record<string, string>;
    };

    expect(ready.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.checks).toMatchObject({
      database: "ok",
      redis: "not_configured",
    });
  });
});

describe("acceptance: two-axis isolation", () => {
  it("hides a project from another workspace and from a workspace non-member", async () => {
    const ours = await workspaceWithProject();
    const stranger = await workspaceWithProject("Other Platform");
    const colleague = await person(ours, "member");

    const foreign = await app.request(`/v1/projects/${ours.projectKey}/flags?environmentKey=development`, {
      headers: { cookie: stranger.session.cookie },
    });
    // 404, never 403: a 403 would confirm the project exists.
    expect(foreign.status).toBe(404);

    const nonMember = await app.request(`/v1/projects/${ours.projectKey}/flags?environmentKey=development`, {
      headers: { cookie: colleague.cookie },
    });
    expect(nonMember.status).toBe(404);
  });
});

describe("acceptance: the role matrix", () => {
  it("gives a viewer read access and no writes", async () => {
    const workspace = await workspaceWithProject();
    const viewer = await person(workspace, "member", "viewer");

    const read = await app.request(`/v1/projects/${workspace.projectKey}/flags?environmentKey=development`, {
      headers: { cookie: viewer.cookie },
    });
    expect(read.status).toBe(200);

    const writes = await Promise.all([
      app.request(`/v1/projects/${workspace.projectKey}/flags`, {
        method: "POST",
        headers: headers(viewer),
        body: JSON.stringify({
          key: "beta",
          name: "Beta",
          type: "boolean",
        }),
      }),
      app.request(`/v1/projects/${workspace.projectKey}/segments`, {
        method: "POST",
        headers: headers(viewer),
        body: JSON.stringify({ name: "Beta", key: "beta-users", rules: [] }),
      }),
      app.request(`/v1/projects/${workspace.projectKey}/environments`, {
        method: "POST",
        headers: headers(viewer),
        body: JSON.stringify({ name: "Staging", key: "staging" }),
      }),
      app.request(`/v1/projects/${workspace.projectKey}/api-keys`, {
        method: "POST",
        headers: headers(viewer),
        body: JSON.stringify({ name: "Key", scopes: ["flags:read"] }),
      }),
      app.request(`/v1/projects/${workspace.projectKey}/members`, {
        method: "POST",
        headers: headers(viewer),
        body: JSON.stringify({ userId: "anyone", role: "viewer" }),
      }),
    ]);

    expect(writes.map((response) => response.status)).toEqual([
      403, 403, 403, 403, 403,
    ]);
  });

  it("lets an engineer write flags and segments but not environments, keys or members", async () => {
    const workspace = await workspaceWithProject();
    const engineer = await person(workspace, "member", "engineer");

    const flag = await app.request(`/v1/projects/${workspace.projectKey}/flags`, {
      method: "POST",
      headers: headers(engineer),
      body: JSON.stringify({
        key: "beta",
        name: "Beta",
        type: "boolean",
      }),
    });
    expect(flag.status).toBe(201);

    const segment = await app.request(
      `/v1/projects/${workspace.projectKey}/segments`,
      {
        method: "POST",
        headers: headers(engineer),
        body: JSON.stringify({ name: "Beta", key: "beta-users", rules: [] }),
      },
    );
    expect(segment.status).toBe(201);

    const refused = await Promise.all([
      app.request(`/v1/projects/${workspace.projectKey}/environments`, {
        method: "POST",
        headers: headers(engineer),
        body: JSON.stringify({ name: "Staging", key: "staging" }),
      }),
      app.request(`/v1/projects/${workspace.projectKey}/api-keys`, {
        method: "POST",
        headers: headers(engineer),
        body: JSON.stringify({ name: "Key", scopes: ["flags:read"] }),
      }),
      app.request(`/v1/projects/${workspace.projectKey}/members`, {
        method: "POST",
        headers: headers(engineer),
        body: JSON.stringify({ userId: "anyone", role: "viewer" }),
      }),
    ]);

    expect(refused.map((response) => response.status)).toEqual([403, 403, 403]);
  });

  it("treats a workspace admin as an implicit project admin", async () => {
    const workspace = await workspaceWithProject();
    const admin = await person(workspace, "admin");

    const key = await app.request(`/v1/projects/${workspace.projectKey}/api-keys`, {
      method: "POST",
      headers: headers(admin),
      body: JSON.stringify({ name: "Key", scopes: ["flags:read"] }),
    });
    expect(key.status).toBe(201);

    const environment = await app.request(
      `/v1/projects/${workspace.projectKey}/environments`,
      {
        method: "POST",
        headers: headers(admin),
        body: JSON.stringify({ name: "Staging", key: "staging" }),
      },
    );
    expect(environment.status).toBe(201);

    // Renaming the project itself stays owner-only.
    const rename = await app.request(`/v1/projects/${workspace.projectKey}`, {
      method: "PATCH",
      headers: headers(admin),
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(rename.status).toBe(403);
  });
});

describe("acceptance: secrets and pagination", () => {
  it("returns an API key secret once and never in a list", async () => {
    const workspace = await workspaceWithProject();

    const created = await app.request(
      `/v1/projects/${workspace.projectKey}/api-keys`,
      {
        method: "POST",
        headers: headers(workspace.session),
        body: JSON.stringify({ name: "CI", scopes: ["flags:read"] }),
      },
    );
    const body = (await created.json()) as { secret: string };

    expect(body.secret).toBeTruthy();

    const list = await app.request(`/v1/projects/${workspace.projectKey}/api-keys`, {
      headers: { cookie: workspace.session.cookie },
    });
    const text = await list.text();

    expect(text).not.toContain(body.secret);
    expect(JSON.parse(text)).toMatchObject({
      data: [expect.objectContaining({ id: expect.any(String) })],
      nextCursor: null,
    });
  });

  it("pages flags without repeating or skipping a row", async () => {
    const workspace = await workspaceWithProject();

    for (const key of ["alpha", "beta", "gamma"]) {
      const created = await app.request(
        `/v1/projects/${workspace.projectKey}/flags`,
        {
          method: "POST",
          headers: headers(workspace.session),
          body: JSON.stringify({
            key,
            name: key,
            type: "boolean",
          }),
        },
      );
      expect(created.status).toBe(201);
    }

    const first = await app.request(
      `/v1/projects/${workspace.projectKey}/flags?environmentKey=development&limit=2`,
      { headers: { cookie: workspace.session.cookie } },
    );
    const firstPage = (await first.json()) as {
      data: FlagSummary[];
      nextCursor: string | null;
    };

    expect(firstPage.data).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const second = await app.request(
      `/v1/projects/${workspace.projectKey}/flags?environmentKey=development&limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      { headers: { cookie: workspace.session.cookie } },
    );
    const secondPage = (await second.json()) as {
      data: FlagSummary[];
      nextCursor: string | null;
    };

    expect(firstPage.data.map((flag) => flag.key)).toEqual(["alpha", "beta"]);
    expect(secondPage.data.map((flag) => flag.key)).toEqual(["gamma"]);
    expect(secondPage.nextCursor).toBeNull();
  });
});

describe("acceptance: audit", () => {
  it("writes exactly one row per mutation and none for a rejected one", async () => {
    const workspace = await workspaceWithProject();
    const { db } = await import("../db/client.js");
    const { auditLog } = await import("../db/schema/index.js");

    const before = (await db.select().from(auditLog)).length;

    await app.request(`/v1/projects/${workspace.projectKey}/flags`, {
      method: "POST",
      headers: headers(workspace.session),
      body: JSON.stringify({
        key: "beta",
        name: "Beta",
        type: "boolean",
      }),
    });

    const rejected = await app.request(
      `/v1/projects/${workspace.projectKey}/flags`,
      {
        method: "POST",
        headers: headers(workspace.session),
        body: JSON.stringify({
          key: "beta",
          name: "Beta again",
          type: "boolean",
        }),
      },
    );
    expect(rejected.status).toBe(409);

    const rows = await db.select().from(auditLog);
    expect(rows.length).toBe(before + 1);
    expect(rows.filter((row) => row.action === "flag.created")).toHaveLength(1);
  });
});

describe("acceptance: configuration reaches evaluation", () => {
  it("serves a segment rule published through the API", async () => {
    const workspace = await workspaceWithProject();

    await app.request(`/v1/projects/${workspace.projectKey}/flags`, {
      method: "POST",
      headers: headers(workspace.session),
      body: JSON.stringify({
        key: "checkout-v2",
        name: "Checkout",
        type: "boolean",
      }),
    });

    await app.request(
      `/v1/projects/${workspace.projectKey}/flags/checkout-v2/environments/development`,
      {
        method: "PATCH",
        headers: headers(workspace.session),
        body: JSON.stringify({
          enabled: true,
          offVariation: "off",
          defaultVariation: "on",
          // Fully on, so the only thing deciding this case is the segment rule.
          rolloutPercentage: 100,
          bucketBy: "userId",
        }),
      },
    );

    await app.request(`/v1/projects/${workspace.projectKey}/segments`, {
      method: "POST",
      headers: headers(workspace.session),
      body: JSON.stringify({
        name: "Beta users",
        key: "beta-users",
        rules: [
          {
            attribute: "plan",
            attributeType: "string",
            operator: "equals",
            values: ["beta"],
          },
        ],
      }),
    });

    await app.request(
      `/v1/projects/${workspace.projectKey}/flags/checkout-v2/environments/development/rules`,
      {
        method: "PUT",
        headers: headers(workspace.session),
        body: JSON.stringify({
          rules: [
            {
              description: "Beta cohort",
              conditions: [],
              variation: "off",
              segmentKeys: ["beta-users"],
            },
          ],
        }),
      },
    );

    const beta = await app.request("/v1/evaluate", {
      method: "POST",
      headers: headers(workspace.session),
      body: JSON.stringify({
        flag: "checkout-v2",
        environment: "development",
        projectKey: workspace.projectKey,
        user: { id: "user-1", plan: "beta" },
      }),
    });
    const betaResult = (await beta.json()) as EvaluationResult;

    expect(betaResult).toMatchObject({
      flag: "checkout-v2",
      variation: "off",
      enabled: false,
      reason: "segment",
    });

    const other = await app.request("/v1/evaluate", {
      method: "POST",
      headers: headers(workspace.session),
      body: JSON.stringify({
        flag: "checkout-v2",
        environment: "development",
        projectKey: workspace.projectKey,
        user: { id: "user-2", plan: "free" },
      }),
    });

    await expect(other.json()).resolves.toMatchObject({
      variation: "on",
      enabled: true,
      reason: "default_variation",
    });
  });
});

describe("acceptance: membership", () => {
  it("adds a colleague and stops their access once removed", async () => {
    const workspace = await workspaceWithProject();
    const colleague = await person(workspace, "member", "viewer");

    const readBefore = await app.request(
      `/v1/projects/${workspace.projectKey}/flags?environmentKey=development`,
      { headers: { cookie: colleague.cookie } },
    );
    expect(readBefore.status).toBe(200);

    const roster = await app.request(
      `/v1/projects/${workspace.projectKey}/members`,
      { headers: { cookie: workspace.session.cookie } },
    );
    const members = (await roster.json()) as ProjectMember[];
    expect(members.map((member) => member.role)).toContain("viewer");

    const removed = await app.request(
      `/v1/projects/${workspace.projectKey}/members/${colleague.userId}`,
      { method: "DELETE", headers: { cookie: workspace.session.cookie } },
    );
    expect(removed.status).toBe(200);

    // Membership is resolved per request, never from a session claim.
    const readAfter = await app.request(
      `/v1/projects/${workspace.projectKey}/flags?environmentKey=development`,
      { headers: { cookie: colleague.cookie } },
    );
    expect(readAfter.status).toBe(404);
  });
});

describe("acceptance: audit is readable through the API", () => {
  it("returns the project's history", async () => {
    const workspace = await workspaceWithProject();

    const response = await app.request(
      `/v1/projects/${workspace.projectKey}/audit-logs`,
      { headers: { cookie: workspace.session.cookie } },
    );
    const body = (await response.json()) as { data: AuditLogEntry[] };

    expect(body.data.map((entry) => entry.action)).toContain("project.created");
  });
});
