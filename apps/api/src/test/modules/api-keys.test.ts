import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ApiKey, CreatedApiKey } from "@iwifunni/contracts";
import { MANAGEMENT_API_KEY_SCOPES } from "@iwifunni/contracts";

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

async function issueKey(
  fixtureUnderTest: Fixture,
  body: Record<string, unknown> = {},
): Promise<CreatedApiKey> {
  const response = await app.request(
    `/v1/projects/${fixtureUnderTest.projectKey}/api-keys`,
    {
      method: "POST",
      headers: headers(fixtureUnderTest.session),
      body: JSON.stringify({
        name: "CI pipeline",
        environmentKey: "development",
        scopes: ["flags:read"],
        expiresInDays: 30,
        ...body,
      }),
    },
  );

  expect(response.status).toBe(201);

  return (await response.json()) as CreatedApiKey;
}

describe("api-keys module", () => {
  it("returns the secret once and stores only its hash", async () => {
    const underTest = await fixture();
    const created = await issueKey(underTest);

    expect(created.secret).toContain(created.prefix);
    expect(created.environmentKey).toBe("development");
    expect(created.expiresAt).not.toBeNull();

    const { db } = await import("../../db/client.js");
    const { apiKey } = await import("../../db/schema/index.js");
    const [row] = await db.select().from(apiKey);

    expect(row?.secretHash).not.toBe(created.secret);
    expect(row?.secretHash).toHaveLength(64);
    expect(row?.prefix).toBe(created.prefix);

    const list = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys`,
      { headers: { cookie: underTest.session.cookie } },
    );
    const body = (await list.json()) as { data: ApiKey[] };

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).not.toHaveProperty("secret");
    expect(body.data[0]?.prefix).toBe(created.prefix);
  });

  it("assigns the scopes a kind implies when none are sent", async () => {
    const underTest = await fixture();

    const management = await issueKey(underTest, {
      name: "Management",
      scopes: undefined,
    });
    const sdk = await issueKey(underTest, {
      name: "SDK",
      kind: "server",
      environmentKey: "development",
      scopes: undefined,
    });

    expect(management.scopes).toEqual([...MANAGEMENT_API_KEY_SCOPES]);
    expect(sdk.scopes).toEqual(["flags:read"]);
  });

  it("stores the secret's tail so the list can mask it", async () => {
    const underTest = await fixture();
    const created = await issueKey(underTest);

    expect(created.suffix).toBe(created.secret.slice(-4));
    expect(created.suffix).toHaveLength(4);
  });

  it("renames a key without touching its secret", async () => {
    const underTest = await fixture();
    const created = await issueKey(underTest);

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys/${created.id}`,
      {
        method: "PATCH",
        headers: headers(underTest.session),
        body: JSON.stringify({ name: "Renamed" }),
      },
    );

    expect(response.status).toBe(200);
    const renamed = (await response.json()) as ApiKey;

    expect(renamed.name).toBe("Renamed");
    expect(renamed.prefix).toBe(created.prefix);
    expect(renamed.suffix).toBe(created.suffix);

    const { db } = await import("../../db/client.js");
    const { auditLog } = await import("../../db/schema/index.js");
    const actions = (await db.select().from(auditLog)).map((row) => row.action);

    expect(actions).toContain("api_key.updated");
  });

  it("rotates a key onto a new secret, and refuses a revoked one", async () => {
    const underTest = await fixture();
    const created = await issueKey(underTest);

    const path = `/v1/projects/${underTest.projectKey}/api-keys/${created.id}/rotate`;

    const rotated = await app.request(path, {
      method: "POST",
      headers: { cookie: underTest.session.cookie },
    });

    expect(rotated.status).toBe(200);
    const body = (await rotated.json()) as CreatedApiKey;

    expect(body.secret).not.toBe(created.secret);
    expect(body.prefix).toBe(created.prefix);
    expect(body.suffix).toBe(body.secret.slice(-4));

    const revoked = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys/${created.id}`,
      { method: "DELETE", headers: { cookie: underTest.session.cookie } },
    );
    expect(revoked.status).toBe(200);

    const refused = await app.request(path, {
      method: "POST",
      headers: { cookie: underTest.session.cookie },
    });
    expect(refused.status).toBe(409);
  });

  it("hides revoked keys by default and returns them on request", async () => {
    const underTest = await fixture();
    const created = await issueKey(underTest);

    const revoked = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys/${created.id}`,
      { method: "DELETE", headers: { cookie: underTest.session.cookie } },
    );

    expect(revoked.status).toBe(200);
    const revokedBody = (await revoked.json()) as ApiKey;
    expect(revokedBody.revokedAt).not.toBeNull();

    const visible = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys`,
      { headers: { cookie: underTest.session.cookie } },
    );
    await expect(visible.json()).resolves.toMatchObject({ data: [] });

    const all = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys?includeRevoked=true`,
      { headers: { cookie: underTest.session.cookie } },
    );
    await expect(all.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: created.id })],
    });

    // "false" is a non-empty string; coercing it would include the row.
    const explicitFalse = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys?includeRevoked=false`,
      { headers: { cookie: underTest.session.cookie } },
    );
    await expect(explicitFalse.json()).resolves.toMatchObject({ data: [] });
  });

  it("lists one environment's keys together with the project-wide ones", async () => {
    const underTest = await fixture();

    await issueKey(underTest, { name: "Development SDK" });
    await issueKey(underTest, {
      name: "Production SDK",
      environmentKey: "production",
    });
    // Issued without an environment, so it authenticates in both.
    await issueKey(underTest, { name: "Everywhere", environmentKey: null });

    const scoped = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys?environmentKey=production`,
      { headers: { cookie: underTest.session.cookie } },
    );

    expect(scoped.status).toBe(200);
    const body = (await scoped.json()) as { data: ApiKey[] };

    expect(body.data.map((key) => key.name).sort()).toEqual([
      "Everywhere",
      "Production SDK",
    ]);

    const unfiltered = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys`,
      { headers: { cookie: underTest.session.cookie } },
    );
    const all = (await unfiltered.json()) as { data: ApiKey[] };

    expect(all.data).toHaveLength(3);
  });

  it("answers an unknown environment filter with 404", async () => {
    const underTest = await fixture();
    await issueKey(underTest);

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys?environmentKey=nope`,
      { headers: { cookie: underTest.session.cookie } },
    );

    expect(response.status).toBe(404);
  });

  it("makes revocation idempotent without a second audit row", async () => {
    const underTest = await fixture();
    const created = await issueKey(underTest);

    const path = `/v1/projects/${underTest.projectKey}/api-keys/${created.id}`;

    const first = await app.request(path, {
      method: "DELETE",
      headers: { cookie: underTest.session.cookie },
    });
    const second = await app.request(path, {
      method: "DELETE",
      headers: { cookie: underTest.session.cookie },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const firstBody = (await first.json()) as ApiKey;
    const secondBody = (await second.json()) as ApiKey;
    expect(secondBody.revokedAt).toBe(firstBody.revokedAt);

    const { db } = await import("../../db/client.js");
    const { auditLog } = await import("../../db/schema/index.js");
    const actions = (await db.select().from(auditLog)).map((row) => row.action);

    expect(actions.filter((action) => action === "api_key.revoked")).toHaveLength(
      1,
    );
    expect(actions).toContain("api_key.created");
  });

  it("rejects an environment key from another project", async () => {
    const underTest = await fixture();

    const other = await app.request("/v1/projects", {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({ name: "Other" }),
    });
    expect(other.status).toBe(201);
    const otherProject = (await other.json()) as { key: string };

    // An environment key that exists in the other project only.
    const foreignEnvironment = await app.request(
      `/v1/projects/${otherProject.key}/environments`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({ name: "QA", key: "qa" }),
      },
    );
    expect(foreignEnvironment.status).toBe(201);

    const foreign = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({
          name: "Nope",
          environmentKey: "qa",
          scopes: ["flags:read"],
        }),
      },
    );

    expect(foreign.status).toBe(400);

    const unknown = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({
          name: "Nope",
          environmentKey: "staging",
          scopes: ["flags:read"],
        }),
      },
    );
    expect(unknown.status).toBe(400);

    // A workspace-wide key is still allowed.
    const created = await issueKey(underTest, { environmentKey: null });
    expect(created.environmentId).toBeNull();
    expect(created.environmentKey).toBeNull();
  });

  it("refuses a viewer, and hides another workspace's keys", async () => {
    const underTest = await fixture();
    const created = await issueKey(underTest);
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

    const read = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys`,
      { headers: { cookie: viewer.cookie } },
    );
    expect(read.status).toBe(200);

    const issue = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys`,
      {
        method: "POST",
        headers: headers(viewer),
        body: JSON.stringify({ name: "Nope", scopes: ["flags:read"] }),
      },
    );
    expect(issue.status).toBe(403);

    const revoke = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys/${created.id}`,
      { method: "DELETE", headers: { cookie: viewer.cookie } },
    );
    expect(revoke.status).toBe(403);

    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");

    const foreign = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys`,
      { headers: { cookie: outsider.cookie } },
    );
    expect(foreign.status).toBe(404);
  });
});
