import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type {
  ApiKey,
  EnvironmentDetail,
  EnvironmentSummary,
  FlagDetail,
  FlagEnvironmentConfig,
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

async function ownerWithProject(): Promise<{
  session: TestSession;
  organizationId: string;
  projectKey: string;
  projectId: string;
}> {
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

async function listEnvironments(
  projectKey: string,
  session: TestSession,
  query = "",
): Promise<EnvironmentSummary[]> {
  const response = await app.request(
    `/v1/projects/${projectKey}/environments${query}`,
    { headers: { cookie: session.cookie } },
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: EnvironmentSummary[] };

  return body.data;
}

async function archive(
  projectKey: string,
  environmentKey: string,
  session: TestSession,
): Promise<Response> {
  return app.request(
    `/v1/projects/${projectKey}/environments/${environmentKey}/archive`,
    { method: "POST", headers: { cookie: session.cookie } },
  );
}

async function unarchive(
  projectKey: string,
  environmentKey: string,
  session: TestSession,
): Promise<Response> {
  return app.request(
    `/v1/projects/${projectKey}/environments/${environmentKey}/unarchive`,
    { method: "POST", headers: { cookie: session.cookie } },
  );
}

describe("environments module", () => {
  it("creates Development and Production when the project is created", async () => {
    const { session, projectKey } = await ownerWithProject();

    const response = await app.request(
      `/v1/projects/${projectKey}/environments`,
      { headers: { cookie: session.cookie } },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{
        key: string;
        name: string;
        isDefault: boolean;
        isProtected: boolean;
      }>;
      nextCursor: string | null;
    };

    expect(body.data).toMatchObject([
      {
        key: "development",
        name: "Development",
        color: "cyan",
        isDefault: true,
        isProtected: false,
      },
      {
        key: "production",
        name: "Production",
        color: "purple",
        isDefault: false,
        isProtected: false,
      },
    ]);
  });

  it("configures every flag disabled by default and copies one when asked", async () => {
    const { session, projectKey } = await ownerWithProject();

    await app.request(`/v1/projects/${projectKey}/flags`, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        key: "checkout-v2",
        name: "Checkout v2",
        type: "boolean",
      }),
    });

    await app.request(
      `/v1/projects/${projectKey}/flags/checkout-v2/environments/development`,
      {
        method: "PATCH",
        headers: headers(session),
        body: JSON.stringify({
          enabled: true,
          offVariation: "off",
          defaultVariation: "on",
          rolloutPercentage: 100,
          bucketBy: "userId",
        }),
      },
    );

    const copied = await app.request(
      `/v1/projects/${projectKey}/environments`,
      {
        method: "POST",
        headers: headers(session),
        body: JSON.stringify({
          name: "Staging",
          key: "staging",
          copyFrom: "development",
          initialFlagStatus: "copy-source",
        }),
      },
    );
    expect(copied.status).toBe(201);

    const read = (key: string) =>
      app.request(
        `/v1/projects/${projectKey}/flags/checkout-v2/environments/${key}`,
        { headers: { cookie: session.cookie } },
      );

    // Copying carries the whole configuration, not merely the flag's existence.
    const staging = (await (
      await read("staging")
    ).json()) as FlagEnvironmentConfig;
    expect(staging).toMatchObject({ enabled: true, rolloutPercentage: 100 });

    // The starter environments are configured too, disabled — a flag is
    // project-scoped, so it exists everywhere, and nothing is copied unless a
    // source is named.
    const production = (await (
      await read("production")
    ).json()) as FlagEnvironmentConfig;
    expect(production).toMatchObject({ enabled: false, rolloutPercentage: 0 });

    // Variations belong to the flag, not to one environment's configuration.
    const detail = await app.request(
      `/v1/projects/${projectKey}/flags/checkout-v2`,
      { headers: { cookie: session.cookie } },
    );
    const flag = (await detail.json()) as FlagDetail;
    expect(flag.variations).toHaveLength(2);
  });

  it("refuses copy-source without an environment to copy", async () => {
    const { session, projectKey } = await ownerWithProject();

    const response = await app.request(
      `/v1/projects/${projectKey}/environments`,
      {
        method: "POST",
        headers: headers(session),
        body: JSON.stringify({
          name: "Staging",
          key: "staging",
          initialFlagStatus: "copy-source",
        }),
      },
    );

    expect(response.status).toBe(400);
  });

  it("refuses a duplicate environment key with 409", async () => {
    const { session, projectKey } = await ownerWithProject();

    const response = await app.request(
      `/v1/projects/${projectKey}/environments`,
      {
        method: "POST",
        headers: headers(session),
        body: JSON.stringify({ name: "Development again", key: "development" }),
      },
    );

    expect(response.status).toBe(409);
  });

  it("updates protection, writes one audit row and returns the connection", async () => {
    const { session, projectKey } = await ownerWithProject();

    const response = await app.request(
      `/v1/projects/${projectKey}/environments/development/settings`,
      {
        method: "PATCH",
        headers: headers(session),
        body: JSON.stringify({ isProtected: true }),
      },
    );

    expect(response.status).toBe(200);
    const detail = (await response.json()) as EnvironmentDetail;

    expect(detail.isProtected).toBe(true);
    expect(detail.connection.evalUrl).toMatch(/\/v1\/evaluate$/);
    // Streaming and keys do not exist yet, so neither is advertised.
    expect(detail.connection.streamUrl).toBe("http://localhost/v1/sdk/stream");
    expect(detail.connection.maskedKey).toBeNull();

    const { db } = await import("../../db/client.js");
    const { auditLog } = await import("../../db/schema/index.js");
    const audits = await db.select().from(auditLog);

    expect(audits.map((row) => row.action).sort()).toEqual([
      "environment.updated",
      "project.created",
    ]);
  });

  it("rejects the retired settings body rather than ignoring it", async () => {
    const { session, projectKey } = await ownerWithProject();

    const response = await app.request(
      `/v1/projects/${projectKey}/environments/development/settings`,
      {
        method: "PATCH",
        headers: headers(session),
        body: JSON.stringify({ protectedEnvironment: true }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
    });
  });

  it("lets a viewer read but not create, and hides other workspaces", async () => {
    const { organizationId, projectKey, projectId } = await ownerWithProject();
    const { db } = await import("../../db/client.js");
    const { member, projectMember } = await import("../../db/schema/index.js");

    // Same workspace, explicit viewer role on this project.
    const viewer = await signUp(app);
    await db.insert(member).values({
      id: randomUUID(),
      organizationId,
      userId: viewer.userId,
      role: "member",
    });
    await db.insert(projectMember).values({
      id: randomUUID(),
      projectId,
      userId: viewer.userId,
      role: "viewer",
    });

    const read = await app.request(`/v1/projects/${projectKey}/environments`, {
      headers: { cookie: viewer.cookie },
    });
    expect(read.status).toBe(200);

    const write = await app.request(`/v1/projects/${projectKey}/environments`, {
      method: "POST",
      headers: headers(viewer),
      body: JSON.stringify({ name: "Nope", key: "nope" }),
    });
    expect(write.status).toBe(403);

    const rename = await app.request(
      `/v1/projects/${projectKey}/environments/development`,
      {
        method: "PATCH",
        headers: headers(viewer),
        body: JSON.stringify({ name: "Nope" }),
      },
    );
    expect(rename.status).toBe(403);

    const archiveResponse = await archive(projectKey, "development", viewer);
    expect(archiveResponse.status).toBe(403);

    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");

    const foreign = await app.request(
      `/v1/projects/${projectKey}/environments`,
      { headers: { cookie: outsider.cookie } },
    );
    expect(foreign.status).toBe(404);
  });

  it("renames an environment and edits its description, never its key", async () => {
    const { session, projectKey } = await ownerWithProject();

    const response = await app.request(
      `/v1/projects/${projectKey}/environments/development`,
      {
        method: "PATCH",
        headers: headers(session),
        // `key` is not part of the identity update and must be ignored.
        body: JSON.stringify({
          name: "Local Development",
          description: "Used for local development and testing.",
          key: "dev",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      key: "development",
      name: "Local Development",
      description: "Used for local development and testing.",
    });

    const byOriginalKey = await app.request(
      `/v1/projects/${projectKey}/environments/development`,
      { headers: { cookie: session.cookie } },
    );
    expect(byOriginalKey.status).toBe(200);

    const byRejectedKey = await app.request(
      `/v1/projects/${projectKey}/environments/dev`,
      { headers: { cookie: session.cookie } },
    );
    expect(byRejectedKey.status).toBe(404);

    const cleared = await app.request(
      `/v1/projects/${projectKey}/environments/development`,
      {
        method: "PATCH",
        headers: headers(session),
        body: JSON.stringify({ name: "Local Development", description: "" }),
      },
    );
    await expect(cleared.json()).resolves.toMatchObject({
      description: null,
    });

    const { db } = await import("../../db/client.js");
    const { auditLog } = await import("../../db/schema/index.js");
    const audits = await db.select().from(auditLog);

    expect(
      audits.filter((row) => row.action === "environment.updated"),
    ).toHaveLength(2);
  });

  it("archives reversibly: revokes its own keys, keeps configuration, promotes the default", async () => {
    const { session, projectKey } = await ownerWithProject();

    await app.request(`/v1/projects/${projectKey}/flags`, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        key: "checkout-v2",
        name: "Checkout v2",
        type: "boolean",
      }),
    });

    await app.request(
      `/v1/projects/${projectKey}/flags/checkout-v2/environments/development`,
      {
        method: "PATCH",
        headers: headers(session),
        body: JSON.stringify({
          enabled: true,
          offVariation: "off",
          defaultVariation: "on",
          rolloutPercentage: 100,
          bucketBy: "userId",
        }),
      },
    );

    const scoped = await app.request(`/v1/projects/${projectKey}/api-keys`, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        name: "Development SDK",
        environmentKey: "development",
        scopes: ["flags:read"],
      }),
    });
    expect(scoped.status).toBe(201);

    const projectWide = await app.request(
      `/v1/projects/${projectKey}/api-keys`,
      {
        method: "POST",
        headers: headers(session),
        body: JSON.stringify({ name: "Everywhere", scopes: ["flags:read"] }),
      },
    );
    expect(projectWide.status).toBe(201);

    const response = await archive(projectKey, "development", session);
    expect(response.status).toBe(200);

    const detail = (await response.json()) as EnvironmentDetail;
    expect(detail.archivedAt).not.toBeNull();

    // Only the key that named this environment is withdrawn.
    const keys = await app.request(
      `/v1/projects/${projectKey}/api-keys?includeRevoked=true`,
      { headers: { cookie: session.cookie } },
    );
    const keyList = (await keys.json()) as { data: ApiKey[] };
    const byName = new Map(keyList.data.map((key) => [key.name, key]));

    expect(byName.get("Development SDK")?.revokedAt).not.toBeNull();
    expect(byName.get("Everywhere")?.revokedAt).toBeNull();

    // Configuration survives the archive, which is what makes it reversible.
    const flag = await app.request(
      `/v1/projects/${projectKey}/flags/checkout-v2/environments/development`,
      { headers: { cookie: session.cookie } },
    );

    await expect(flag.json()).resolves.toMatchObject({
      environmentKey: "development",
      enabled: true,
      rolloutPercentage: 100,
    });

    // The archived environment leaves the list and hands the default over.
    const active = await listEnvironments(projectKey, session);
    expect(active.map((environment) => environment.key)).toEqual([
      "production",
    ]);
    expect(active[0]?.isDefault).toBe(true);

    const { db } = await import("../../db/client.js");
    const { auditLog } = await import("../../db/schema/index.js");
    const audits = await db.select().from(auditLog);
    const archivedRow = audits.find(
      (row) => row.action === "environment.archived",
    );

    expect(archivedRow?.changes).toMatchObject({
      key: "development",
      revokedKeys: 1,
    });
  });

  it("keeps the last active environment from being archived", async () => {
    const { session, projectKey } = await ownerWithProject();

    // Production goes first, so Development is the last one standing.
    expect((await archive(projectKey, "production", session)).status).toBe(200);

    const response = await archive(projectKey, "development", session);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: "A project must have at least one active environment.",
      },
    });

    const active = await listEnvironments(projectKey, session);
    expect(active).toMatchObject([
      { key: "development", archivedAt: null, isDefault: true },
    ]);
  });

  it("makes an archived environment read-only until it is restored", async () => {
    const { session, projectKey } = await ownerWithProject();

    await app.request(`/v1/projects/${projectKey}/flags`, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        key: "checkout-v2",
        name: "Checkout v2",
        type: "boolean",
      }),
    });

    expect((await archive(projectKey, "development", session)).status).toBe(
      200,
    );

    // Hidden by default, offered when the caller asks for the archive.
    expect(
      (await listEnvironments(projectKey, session)).map((e) => e.key),
    ).toEqual(["production"]);
    expect(
      (
        await listEnvironments(projectKey, session, "?includeArchived=true")
      ).map((environment) => environment.key),
    ).toEqual(["development", "production"]);
    // "false" is a non-empty string; coercing it would include the archive.
    expect(
      (
        await listEnvironments(projectKey, session, "?includeArchived=false")
      ).map((environment) => environment.key),
    ).toEqual(["production"]);

    // Anything but true or false is rejected rather than guessed at.
    const garbage = await app.request(
      `/v1/projects/${projectKey}/environments?includeArchived=maybe`,
      { headers: { cookie: session.cookie } },
    );
    expect(garbage.status).toBe(400);

    for (const [path, body] of [
      ["", { name: "Renamed while archived" }],
      ["/settings", { isProtected: true }],
    ] as const) {
      const write = await app.request(
        `/v1/projects/${projectKey}/environments/development${path}`,
        {
          method: "PATCH",
          headers: headers(session),
          body: JSON.stringify(body),
        },
      );
      expect(write.status).toBe(409);
    }

    expect((await archive(projectKey, "development", session)).status).toBe(
      409,
    );

    const restored = await unarchive(projectKey, "development", session);
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({ archivedAt: null });

    expect((await unarchive(projectKey, "development", session)).status).toBe(
      409,
    );

    // Restoring reopens editing, and the released default is not claimed back.
    const renamed = await app.request(
      `/v1/projects/${projectKey}/environments/development`,
      {
        method: "PATCH",
        headers: headers(session),
        body: JSON.stringify({ name: "Development" }),
      },
    );
    expect(renamed.status).toBe(200);

    const active = await listEnvironments(projectKey, session);
    expect(
      active.map((environment) => [environment.key, environment.isDefault]),
    ).toEqual([
      ["development", false],
      ["production", true],
    ]);
  });
});
