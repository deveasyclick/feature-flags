import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type {
  FlagChangeRequest,
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

interface Fixture {
  owner: TestSession;
  engineer: TestSession;
  organizationId: string;
  projectId: string;
  projectKey: string;
}

/**
 * A project whose production environment is protected, with an engineer who can
 * propose and an owner who can approve. Nothing here can approve its own work.
 */
async function fixture(): Promise<Fixture> {
  const owner = await signUp(app);
  const workspace = await seedWorkspace(owner.userId, "owner");

  const created = await app.request("/v1/projects", {
    method: "POST",
    headers: headers(owner),
    body: JSON.stringify({ name: "Checkout Platform" }),
  });
  const project = (await created.json()) as { id: string; key: string };

  await app.request(
    `/v1/projects/${project.key}/environments/production/settings`,
    {
      method: "PATCH",
      headers: headers(owner),
      body: JSON.stringify({ isProtected: true }),
    },
  );

  await app.request(`/v1/projects/${project.key}/flags`, {
    method: "POST",
    headers: headers(owner),
    body: JSON.stringify({
      key: "checkout-v2",
      name: "Checkout v2",
      type: "boolean",
    }),
  });

  const engineer = await signUp(app);
  const { db } = await import("../../db/client.js");
  const { member, projectMember } = await import("../../db/schema/index.js");

  await db.insert(member).values({
    id: randomUUID(),
    organizationId: workspace.organizationId,
    userId: engineer.userId,
    role: "member",
  });
  await db.insert(projectMember).values({
    id: randomUUID(),
    projectId: project.id,
    userId: engineer.userId,
    role: "engineer",
  });

  return {
    owner,
    engineer,
    organizationId: workspace.organizationId,
    projectId: project.id,
    projectKey: project.key,
  };
}

function configPayload(enabled: boolean, rolloutPercentage = 0) {
  return {
    config: {
      enabled,
      offVariation: "off",
      defaultVariation: "on",
      rolloutPercentage,
      bucketBy: "userId",
    },
  };
}

function propose(
  underTest: Fixture,
  session: TestSession,
  payload: unknown,
  environmentKey = "production",
) {
  return app.request(
    `/v1/projects/${underTest.projectKey}/flags/checkout-v2/change-requests`,
    {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({ environmentKey, payload }),
    },
  );
}

function decide(
  underTest: Fixture,
  session: TestSession,
  requestId: string,
  decision: "approve" | "reject",
  note?: string,
) {
  return app.request(
    `/v1/projects/${underTest.projectKey}/flags/checkout-v2/change-requests/${requestId}/${decision}`,
    {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify(note === undefined ? {} : { note }),
    },
  );
}

async function environmentConfig(
  underTest: Fixture,
  session: TestSession,
  environmentKey = "production",
): Promise<FlagEnvironmentConfig> {
  const response = await app.request(
    `/v1/projects/${underTest.projectKey}/flags/checkout-v2/environments/${environmentKey}`,
    { headers: { cookie: session.cookie } },
  );

  if (!response.ok) {
    throw new Error(`No configuration for ${environmentKey}.`);
  }

  return (await response.json()) as FlagEnvironmentConfig;
}

describe("change requests", () => {
  it("refuses a direct publish into a protected environment", async () => {
    const underTest = await fixture();

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/environments/production`,
      {
        method: "PATCH",
        headers: headers(underTest.engineer),
        body: JSON.stringify(configPayload(true, 100).config),
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "approval_required" },
    });

    // The refusal is not a partial write.
    const config = await environmentConfig(underTest, underTest.engineer);
    expect(config).toMatchObject({ enabled: false, rolloutPercentage: 0 });
  });

  it("does not gate an identity edit behind a protected environment", async () => {
    const underTest = await fixture();

    const renamed = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2`,
      {
        method: "PATCH",
        headers: headers(underTest.engineer),
        body: JSON.stringify({ name: "Checkout v2 (renamed)" }),
      },
    );

    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({
      key: "checkout-v2",
      name: "Checkout v2 (renamed)",
    });

    // The same person publishing a configuration into that environment is refused.
    const direct = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/environments/production`,
      {
        method: "PATCH",
        headers: headers(underTest.engineer),
        body: JSON.stringify(configPayload(true, 100).config),
      },
    );

    expect(direct.status).toBe(409);
    await expect(direct.json()).resolves.toMatchObject({
      error: { code: "approval_required" },
    });
  });

  it("applies a proposed change only once somebody else approves it", async () => {
    const underTest = await fixture();

    const proposed = await propose(
      underTest,
      underTest.engineer,
      configPayload(true, 100),
    );
    expect(proposed.status).toBe(201);

    const request = (await proposed.json()) as FlagChangeRequest;
    expect(request).toMatchObject({
      status: "pending",
      flagKey: "checkout-v2",
      environmentKey: "production",
      requestedBy: underTest.engineer.userId,
    });

    // Pending means pending: nothing has reached the environment.
    expect(
      await environmentConfig(underTest, underTest.engineer),
    ).toMatchObject({
      enabled: false,
      rolloutPercentage: 0,
    });

    const approved = await decide(
      underTest,
      underTest.owner,
      request.id,
      "approve",
    );
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({
      status: "approved",
      decidedBy: underTest.owner.userId,
    });

    expect(
      await environmentConfig(underTest, underTest.engineer),
    ).toMatchObject({
      enabled: true,
      rolloutPercentage: 100,
    });

    const { db } = await import("../../db/client.js");
    const { auditLog } = await import("../../db/schema/index.js");
    const actions = (await db.select().from(auditLog)).map((row) => row.action);

    expect(
      actions.filter((action) => action === "change_request.created"),
    ).toHaveLength(1);
    expect(
      actions.filter((action) => action === "change_request.approved"),
    ).toHaveLength(1);
    // The applied change keeps its own audit trail, attributed to the approver.
    expect(actions.filter((action) => action === "flag.enabled")).toHaveLength(
      1,
    );
  });

  it("refuses to let the author approve their own change", async () => {
    const underTest = await fixture();

    const proposed = await propose(
      underTest,
      underTest.owner,
      configPayload(true),
    );
    const request = (await proposed.json()) as FlagChangeRequest;

    const selfApproved = await decide(
      underTest,
      underTest.owner,
      request.id,
      "approve",
    );

    expect(selfApproved.status).toBe(403);
    expect(await environmentConfig(underTest, underTest.owner)).toMatchObject({
      enabled: false,
    });
  });

  it("requires an admin to decide a request", async () => {
    const underTest = await fixture();

    const proposed = await propose(
      underTest,
      underTest.engineer,
      configPayload(true),
    );
    const request = (await proposed.json()) as FlagChangeRequest;

    const response = await decide(
      underTest,
      underTest.engineer,
      request.id,
      "approve",
    );

    expect(response.status).toBe(403);
  });

  it("replaces the pending proposal instead of queueing a second", async () => {
    const underTest = await fixture();

    const first = (await (
      await propose(underTest, underTest.engineer, configPayload(true, 50))
    ).json()) as FlagChangeRequest;

    const second = (await (
      await propose(underTest, underTest.engineer, configPayload(true, 100))
    ).json()) as FlagChangeRequest;

    const list = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/change-requests?status=pending`,
      { headers: { cookie: underTest.owner.cookie } },
    );
    const page = (await list.json()) as { data: FlagChangeRequest[] };

    expect(page.data.map((entry) => entry.id)).toEqual([second.id]);

    const all = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/change-requests`,
      { headers: { cookie: underTest.owner.cookie } },
    );
    const full = (await all.json()) as { data: FlagChangeRequest[] };

    expect(full.data.find((entry) => entry.id === first.id)?.status).toBe(
      "superseded",
    );

    // Only the surviving proposal is decidable, and only it is applied.
    expect(
      (await decide(underTest, underTest.owner, first.id, "approve")).status,
    ).toBe(409);

    expect(
      (await decide(underTest, underTest.owner, second.id, "approve")).status,
    ).toBe(200);
    expect(await environmentConfig(underTest, underTest.owner)).toMatchObject({
      enabled: true,
      rolloutPercentage: 100,
    });
  });

  it("decides a request once", async () => {
    const underTest = await fixture();

    const request = (await (
      await propose(underTest, underTest.engineer, configPayload(true))
    ).json()) as FlagChangeRequest;

    expect(
      (await decide(underTest, underTest.owner, request.id, "approve")).status,
    ).toBe(200);

    const second = await decide(
      underTest,
      underTest.owner,
      request.id,
      "reject",
    );
    expect(second.status).toBe(409);
  });

  it("rejects a proposal without touching the environment", async () => {
    const underTest = await fixture();

    const request = (await (
      await propose(underTest, underTest.engineer, configPayload(true, 100))
    ).json()) as FlagChangeRequest;

    const rejected = await decide(
      underTest,
      underTest.owner,
      request.id,
      "reject",
      "Not before the migration lands.",
    );

    expect(rejected.status).toBe(200);
    await expect(rejected.json()).resolves.toMatchObject({
      status: "rejected",
      decisionNote: "Not before the migration lands.",
    });

    expect(
      await environmentConfig(underTest, underTest.engineer),
    ).toMatchObject({
      enabled: false,
      rolloutPercentage: 0,
    });
  });

  it("refuses a proposal it could never apply", async () => {
    const underTest = await fixture();

    const response = await propose(underTest, underTest.engineer, {
      config: {
        enabled: true,
        offVariation: "off",
        defaultVariation: "missing-variation",
        rolloutPercentage: 0,
        bucketBy: "userId",
      },
    });

    expect(response.status).toBe(400);
    expect(
      (
        (await (
          await app.request(
            `/v1/projects/${underTest.projectKey}/flags/checkout-v2/change-requests`,
            { headers: { cookie: underTest.owner.cookie } },
          )
        ).json()) as { data: FlagChangeRequest[] }
      ).data,
    ).toEqual([]);
  });

  it("refuses an empty proposal", async () => {
    const underTest = await fixture();

    const response = await propose(underTest, underTest.engineer, {});
    expect(response.status).toBe(400);
  });

  it("applies rules, targets and config together in one approval", async () => {
    const underTest = await fixture();

    const request = (await (
      await propose(underTest, underTest.engineer, {
        config: configPayload(true, 100).config,
        rules: {
          rules: [
            {
              description: "Everyone in beta",
              conditions: [
                {
                  attribute: "user.id",
                  attributeType: "string",
                  operator: "in",
                  values: ["u1"],
                },
              ],
              variation: "off",
              segmentKeys: [],
              rollout: null,
            },
          ],
        },
        targets: { targets: [{ userId: "u2", variationKey: "off" }] },
      })
    ).json()) as FlagChangeRequest;

    expect(
      (await decide(underTest, underTest.owner, request.id, "approve")).status,
    ).toBe(200);

    const config = await environmentConfig(underTest, underTest.engineer);

    expect(config).toMatchObject({ enabled: true, rolloutPercentage: 100 });
    expect(config.rules).toHaveLength(1);
    expect(config.individualTargets).toEqual([
      { userId: "u2", variationKey: "off" },
    ]);
  });

  it("tells each caller whether they may decide", async () => {
    const underTest = await fixture();

    const request = (await (
      await propose(underTest, underTest.engineer, configPayload(true))
    ).json()) as FlagChangeRequest;

    const asEngineer = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/change-requests?status=pending`,
      { headers: { cookie: underTest.engineer.cookie } },
    );
    const engineerView = (await asEngineer.json()) as {
      data: FlagChangeRequest[];
    };

    const asOwner = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/change-requests?status=pending`,
      { headers: { cookie: underTest.owner.cookie } },
    );
    const ownerView = (await asOwner.json()) as { data: FlagChangeRequest[] };

    // The engineer proposed it and is not an admin: no button for them.
    expect(engineerView.data[0]?.canDecide).toBe(false);
    expect(request.canDecide).toBe(false);
    // The owner did not propose it: theirs to decide.
    expect(ownerView.data[0]?.canDecide).toBe(true);

    const approved = await decide(
      underTest,
      underTest.owner,
      request.id,
      "approve",
    );
    await expect(approved.json()).resolves.toMatchObject({
      status: "approved",
      // Decided requests are nobody's to decide again.
      canDecide: false,
    });

    // An admin's own proposal is still not theirs to approve.
    const asAuthor = (await (
      await propose(underTest, underTest.owner, configPayload(true))
    ).json()) as FlagChangeRequest;
    expect(asAuthor.canDecide).toBe(false);
  });

  it("keeps another workspace's project invisible", async () => {
    const underTest = await fixture();

    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");

    const proposed = await propose(
      underTest,
      underTest.engineer,
      configPayload(true),
    );
    const request = (await proposed.json()) as FlagChangeRequest;

    const list = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/change-requests`,
      { headers: { cookie: outsider.cookie } },
    );
    const created = await propose(underTest, outsider, configPayload(true));
    const approved = await decide(underTest, outsider, request.id, "approve");

    expect(list.status).toBe(404);
    expect(created.status).toBe(404);
    expect(approved.status).toBe(404);
  });
});
