import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { SegmentDetail } from "@iwifunni/contracts";

import {
  closeTestDatabase,
  loadApp,
  loadTestEnv,
  resetTestDatabase,
  seedProject,
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

async function fixture(role = "owner"): Promise<Fixture> {
  const session = await signUp(app);
  const workspace = await seedWorkspace(session.userId, role);
  const project = await seedProject(workspace.organizationId);

  await seedEnvironment(project.projectId, "staging");

  return {
    session,
    organizationId: workspace.organizationId,
    projectKey: project.key,
    projectId: project.projectId,
  };
}

async function seedEnvironment(projectId: string, key: string): Promise<void> {
  const { db } = await import("../../db/client.js");
  const { environment } = await import("../../db/schema/index.js");

  await db.insert(environment).values({
    id: randomUUID(),
    projectId,
    key,
    name: key,
  });
}

const RULES = [
  {
    attribute: "plan",
    attributeType: "string",
    operator: "equals",
    values: ["beta"],
  },
  {
    attribute: "sessions",
    attributeType: "number",
    operator: "greater_than",
    values: ["5"],
  },
];

describe("segments module", () => {
  it("creates a segment with ordered conditions and returns them on detail", async () => {
    const underTest = await fixture();

    const created = await app.request(
      `/v1/projects/${underTest.projectKey}/segments`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({
          name: "Beta users",
          key: "beta-users",
          description: "Early access",
          rules: RULES,
        }),
      },
    );

    expect(created.status).toBe(201);
    const detail = (await created.json()) as SegmentDetail;

    expect(detail.conditions.map((condition) => condition.attribute)).toEqual([
      "plan",
      "sessions",
    ]);
    expect(detail.archivedAt).toBeNull();

    const list = await app.request(`/v1/projects/${underTest.projectKey}/segments`, {
      headers: { cookie: underTest.session.cookie },
    });
    await expect(list.json()).resolves.toMatchObject({
      data: [{ key: "beta-users", conditionCount: 2 }],
      nextCursor: null,
    });
  });

  it("refuses a duplicate key with 409 and an unknown segment reference with 400", async () => {
    const underTest = await fixture();

    const body = JSON.stringify({ name: "Beta", key: "beta-users", rules: [] });

    const first = await app.request(`/v1/projects/${underTest.projectKey}/segments`, {
      method: "POST",
      headers: headers(underTest.session),
      body,
    });
    expect(first.status).toBe(201);

    const duplicate = await app.request(
      `/v1/projects/${underTest.projectKey}/segments`,
      { method: "POST", headers: headers(underTest.session), body },
    );
    expect(duplicate.status).toBe(409);

    // A targeting rule may only reference a segment that exists.
    await app.request(`/v1/projects/${underTest.projectKey}/flags`, {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({
        key: "checkout-v2",
        name: "Checkout",
        type: "boolean",
      }),
    });

    const rules = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/environments/staging/rules`,
      {
        method: "PUT",
        headers: headers(underTest.session),
        body: JSON.stringify({
          rules: [{ variation: "on", conditions: [], segmentKeys: ["missing"] }],
        }),
      },
    );

    expect(rules.status).toBe(400);
    await expect(rules.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
    });
  });

  it("archives rather than deletes, and hides the archive from the default list", async () => {
    const underTest = await fixture();

    await app.request(`/v1/projects/${underTest.projectKey}/segments`, {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({ name: "Beta", key: "beta-users", rules: RULES }),
    });

    const archived = await app.request(
      `/v1/projects/${underTest.projectKey}/segments/beta-users`,
      { method: "DELETE", headers: { cookie: underTest.session.cookie } },
    );

    expect(archived.status).toBe(200);
    await expect(archived.json()).resolves.toMatchObject({ key: "beta-users" });

    const visible = await app.request(
      `/v1/projects/${underTest.projectKey}/segments`,
      { headers: { cookie: underTest.session.cookie } },
    );
    await expect(visible.json()).resolves.toMatchObject({ data: [] });

    const all = await app.request(
      `/v1/projects/${underTest.projectKey}/segments?includeArchived=true`,
      { headers: { cookie: underTest.session.cookie } },
    );
    await expect(all.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ key: "beta-users" })],
    });

    // "false" is a non-empty string; coercing it would include the row.
    const explicitFalse = await app.request(
      `/v1/projects/${underTest.projectKey}/segments?includeArchived=false`,
      { headers: { cookie: underTest.session.cookie } },
    );
    await expect(explicitFalse.json()).resolves.toMatchObject({ data: [] });

    // The row survives, so rules that reference it by key stay resolvable.
    const detail = await app.request(
      `/v1/projects/${underTest.projectKey}/segments/beta-users`,
      { headers: { cookie: underTest.session.cookie } },
    );
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as SegmentDetail;
    expect(body.archivedAt).not.toBeNull();
    expect(body.conditions).toHaveLength(2);
  });

  it("does not call a flag that serves nobody a rollout", async () => {
    const underTest = await fixture();

    await app.request(`/v1/projects/${underTest.projectKey}/segments`, {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({ name: "Beta", key: "beta-users", rules: RULES }),
    });

    await app.request(`/v1/projects/${underTest.projectKey}/flags`, {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({
        key: "checkout-v2",
        name: "Checkout",
        type: "boolean",
      }),
    });

    await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/environments/staging/rules`,
      {
        method: "PUT",
        headers: headers(underTest.session),
        body: JSON.stringify({
          rules: [
            { variation: "on", conditions: [], segmentKeys: ["beta-users"] },
          ],
        }),
      },
    );

    // Half a rollout, but the flag is switched off, so it serves nobody.
    await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/environments/staging`,
      {
        method: "PATCH",
        headers: headers(underTest.session),
        body: JSON.stringify({
          enabled: false,
          offVariation: "off",
          defaultVariation: "on",
          rolloutPercentage: 50,
          bucketBy: "userId",
        }),
      },
    );

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/segments/beta-users/flags`,
      { headers: { cookie: underTest.session.cookie } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        key: "checkout-v2",
        environmentKey: "staging",
        status: "active",
        isRollout: false,
      },
    ]);
  });

  it("lists the flags that reference the segment", async () => {
    const underTest = await fixture();

    await app.request(`/v1/projects/${underTest.projectKey}/segments`, {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({ name: "Beta", key: "beta-users", rules: RULES }),
    });

    await app.request(`/v1/projects/${underTest.projectKey}/flags`, {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({
        key: "checkout-v2",
        name: "Checkout",
        type: "boolean",
      }),
    });

    await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/environments/staging/rules`,
      {
        method: "PUT",
        headers: headers(underTest.session),
        body: JSON.stringify({
          rules: [
            { variation: "on", conditions: [], segmentKeys: ["beta-users"] },
          ],
        }),
      },
    );

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/segments/beta-users/flags`,
      { headers: { cookie: underTest.session.cookie } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        key: "checkout-v2",
        environmentKey: "staging",
        status: "active",
        isRollout: false,
      },
    ]);
  });

  it("lets a viewer read but not write, and hides other workspaces", async () => {
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

    const read = await app.request(`/v1/projects/${underTest.projectKey}/segments`, {
      headers: { cookie: viewer.cookie },
    });
    expect(read.status).toBe(200);

    const write = await app.request(`/v1/projects/${underTest.projectKey}/segments`, {
      method: "POST",
      headers: headers(viewer),
      body: JSON.stringify({ name: "Nope", key: "nope", rules: [] }),
    });
    expect(write.status).toBe(403);

    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");

    const foreign = await app.request(
      `/v1/projects/${underTest.projectKey}/segments`,
      { headers: { cookie: outsider.cookie } },
    );
    expect(foreign.status).toBe(404);
  });
});
