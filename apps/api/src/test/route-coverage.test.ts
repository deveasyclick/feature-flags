import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type {
  ApiKey,
  EnvironmentDetail,
  EnvironmentSummary,
  FlagDetail,
  FlagEnvironmentConfig,
  SegmentDetail,
  SegmentSummary,
  WorkspaceProfile,
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
 * The route-level edges and pagination the colocated module suites do not reach:
 * identity updates, list paging for the remaining collections, the compound
 * project create's key de-duplication and the defensive metadata parse.
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
}

async function fixture(projectName = "Checkout Platform"): Promise<Fixture> {
  const session = await signUp(app);
  const workspace = await seedWorkspace(session.userId, "owner");

  const created = await app.request("/v1/projects", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ name: projectName }),
  });
  expect(created.status).toBe(201);
  const project = (await created.json()) as { key: string };

  return {
    session,
    organizationId: workspace.organizationId,
    projectKey: project.key,
  };
}

async function createFlag(
  underTest: Fixture,
  key: string,
): Promise<FlagDetail> {
  const response = await app.request(
    `/v1/projects/${underTest.projectKey}/flags`,
    {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({ key, name: key, type: "boolean" }),
    },
  );
  expect(response.status).toBe(201);

  return (await response.json()) as FlagDetail;
}

async function createSegment(
  underTest: Fixture,
  key: string,
): Promise<SegmentDetail> {
  const response = await app.request(
    `/v1/projects/${underTest.projectKey}/segments`,
    {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({ name: key, key, rules: [] }),
    },
  );
  expect(response.status).toBe(201);

  return (await response.json()) as SegmentDetail;
}

describe("route coverage: flag identity", () => {
  it("updates a flag's identity without touching its configuration", async () => {
    const underTest = await fixture();
    await createFlag(underTest, "checkout-v2");

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2`,
      {
        method: "PATCH",
        headers: headers(underTest.session),
        body: JSON.stringify({
          name: "Checkout v2 (renamed)",
          description: "Now with a description",
          tags: ["release", "payments"],
          owner: "platform",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      key: "checkout-v2",
      name: "Checkout v2 (renamed)",
      description: "Now with a description",
      tags: ["release", "payments"],
      owner: "platform",
      // An identity update leaves every environment's configuration alone.
      environments: [
        expect.objectContaining({
          environmentKey: "development",
          enabled: false,
        }),
        expect.objectContaining({
          environmentKey: "production",
          enabled: false,
        }),
      ],
    });

    const { db } = await import("../db/client.js");
    const { auditLog } = await import("../db/schema/index.js");
    const actions = (await db.select().from(auditLog)).map((row) => row.action);

    expect(actions.filter((action) => action === "flag.updated")).toHaveLength(1);
  });

  it("answers an unknown environment with 404 rather than an empty config", async () => {
    const underTest = await fixture();
    await createFlag(underTest, "checkout-v2");

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/environments/nope`,
      { headers: { cookie: underTest.session.cookie } },
    );

    expect(response.status).toBe(404);
  });

  it("refuses an archive by a viewer", async () => {
    const underTest = await fixture();
    await createFlag(underTest, "checkout-v2");

    const viewer = await signUp(app);
    const { db } = await import("../db/client.js");
    const { member, projectMember, project } = await import(
      "../db/schema/index.js"
    );
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select()
      .from(project)
      .where(eq(project.key, underTest.projectKey));

    await db.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: underTest.organizationId,
      userId: viewer.userId,
      role: "member",
    });
    await db.insert(projectMember).values({
      id: crypto.randomUUID(),
      projectId: row?.id ?? "",
      userId: viewer.userId,
      role: "viewer",
    });

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2`,
      { method: "DELETE", headers: { cookie: viewer.cookie } },
    );

    expect(response.status).toBe(403);
  });
});

describe("route coverage: the flag route surface", () => {
  it("exercises every flag route, including the variation routes", async () => {
    const underTest = await fixture();
    await createFlag(underTest, "checkout-v2");
    await createSegment(underTest, "beta-users");

    const flag = `/v1/projects/${underTest.projectKey}/flags/checkout-v2`;
    const config = `${flag}/environments/development`;

    const routes: Array<{
      method: string;
      path: string;
      body?: unknown;
      status: number;
    }> = [
      { method: "GET", path: "/v1/flags", status: 200 },
      {
        method: "GET",
        path: `/v1/flags/checkout-v2?projectKey=${underTest.projectKey}`,
        status: 200,
      },
      {
        method: "GET",
        path: `/v1/projects/${underTest.projectKey}/flags`,
        status: 200,
      },
      {
        method: "POST",
        path: `/v1/projects/${underTest.projectKey}/flags`,
        body: { key: "second-flag", name: "Second flag", type: "boolean" },
        status: 201,
      },
      { method: "GET", path: flag, status: 200 },
      {
        method: "PATCH",
        path: flag,
        body: { name: "Checkout v2" },
        status: 200,
      },
      { method: "GET", path: `${flag}/variations`, status: 200 },
      {
        method: "POST",
        path: `${flag}/variations`,
        body: { key: "maybe", name: "Maybe", value: true },
        status: 201,
      },
      {
        method: "PATCH",
        path: `${flag}/variations/maybe`,
        body: { name: "Maybe later" },
        status: 200,
      },
      { method: "GET", path: config, status: 200 },
      {
        method: "PATCH",
        path: config,
        body: {
          enabled: true,
          offVariation: "off",
          defaultVariation: "on",
          rolloutPercentage: 25,
          bucketBy: "userId",
        },
        status: 200,
      },
      {
        method: "PATCH",
        path: `${config}/enabled`,
        body: { enabled: true },
        status: 200,
      },
      { method: "GET", path: `${config}/rules`, status: 200 },
      {
        method: "PUT",
        path: `${config}/rules`,
        body: {
          rules: [
            {
              description: "Beta cohort",
              conditions: [],
              variation: "on",
              segmentKeys: ["beta-users"],
            },
          ],
        },
        status: 200,
      },
      { method: "GET", path: `${config}/targets`, status: 200 },
      {
        method: "PUT",
        path: `${config}/targets`,
        body: { targets: [{ userId: "user-1", variationKey: "on" }] },
        status: 200,
      },
      {
        method: "PUT",
        path: `${config}/targeting`,
        body: {
          rules: [
            {
              description: "Everything else",
              conditions: [],
              variation: "on",
              segmentKeys: [],
            },
          ],
          targets: [{ userId: "user-2", variationKey: "off" }],
          config: {
            enabled: true,
            offVariation: "off",
            defaultVariation: "on",
            rolloutPercentage: 50,
            bucketBy: "userId",
          },
        },
        status: 200,
      },
      { method: "GET", path: `${config}/versions`, status: 200 },
      { method: "GET", path: `${flag}/dependencies`, status: 200 },
      { method: "DELETE", path: `${flag}/variations/maybe`, status: 200 },
      { method: "DELETE", path: flag, status: 200 },
      { method: "POST", path: `${flag}/unarchive`, status: 200 },
    ];

    for (const route of routes) {
      const response = await app.request(route.path, {
        method: route.method,
        headers: headers(underTest.session),
        ...(route.body === undefined
          ? {}
          : { body: JSON.stringify(route.body) }),
      });

      expect(response.status, `${route.method} ${route.path}`).toBe(
        route.status,
      );
    }
  });
});

describe("route coverage: segment identity", () => {
  it("renames a segment and replaces its conditions", async () => {
    const underTest = await fixture();
    await createSegment(underTest, "beta-users");

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/segments/beta-users`,
      {
        method: "PATCH",
        headers: headers(underTest.session),
        body: JSON.stringify({
          name: "Beta users (v2)",
          rules: [
            {
              attribute: "plan",
              attributeType: "string",
              operator: "equals",
              values: ["beta"],
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      key: "beta-users",
      name: "Beta users (v2)",
      conditions: [
        { attribute: "plan", operator: "equals", values: ["beta"] },
      ],
    });

    const list = await app.request(
      `/v1/projects/${underTest.projectKey}/segments`,
      { headers: { cookie: underTest.session.cookie } },
    );
    await expect(list.json()).resolves.toMatchObject({
      data: [{ key: "beta-users", conditionCount: 1 }],
    });
  });

  it("answers an unknown segment with 404", async () => {
    const underTest = await fixture();

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/segments/nope`,
      { headers: { cookie: underTest.session.cookie } },
    );

    expect(response.status).toBe(404);
  });
});

describe("route coverage: pagination for the remaining collections", () => {
  it("pages environments, segments and api keys one row at a time", async () => {
    const underTest = await fixture();

    await app.request(`/v1/projects/${underTest.projectKey}/environments`, {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({ name: "Staging", key: "staging" }),
    });

    await createSegment(underTest, "alpha-segment");
    await createSegment(underTest, "beta-segment");

    for (const name of ["First key", "Second key"]) {
      const created = await app.request(
        `/v1/projects/${underTest.projectKey}/api-keys`,
        {
          method: "POST",
          headers: headers(underTest.session),
          body: JSON.stringify({ name, scopes: ["flags:read"] }),
        },
      );
      expect(created.status).toBe(201);
    }

    async function walk<T>(
      path: string,
      keyOf: (item: T) => string,
    ): Promise<string[]> {
      const seen: string[] = [];
      let cursor: string | null = null;

      do {
        const query = cursor === null ? "?limit=1" : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
        const response = await app.request(`${path}${query}`, {
          headers: { cookie: underTest.session.cookie },
        });
        expect(response.status).toBe(200);

        const page = (await response.json()) as {
          data: T[];
          nextCursor: string | null;
        };

        seen.push(...page.data.map(keyOf));
        cursor = page.nextCursor;

        // A paging loop that never terminates would hang the suite.
        expect(seen.length).toBeLessThanOrEqual(10);
      } while (cursor !== null);

      return seen;
    }

    const environments = await walk<EnvironmentSummary>(
      `/v1/projects/${underTest.projectKey}/environments`,
      (environment) => environment.key,
    );
    const segments = await walk<SegmentSummary>(
      `/v1/projects/${underTest.projectKey}/segments`,
      (segment) => segment.key,
    );
    const keys = await walk<ApiKey>(
      `/v1/projects/${underTest.projectKey}/api-keys`,
      (key) => key.id,
    );

    expect(environments).toEqual(["development", "production", "staging"]);
    expect(segments).toEqual(["alpha-segment", "beta-segment"]);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("route coverage: compound project create", () => {
  it("de-duplicates the derived key instead of failing", async () => {
    const underTest = await fixture("Alpha Platform");

    const second = await app.request("/v1/projects", {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({ name: "Alpha Platform" }),
    });

    expect(second.status).toBe(201);
    await expect(second.json()).resolves.toMatchObject({
      key: "alpha-platform-2",
      name: "Alpha Platform",
    });

    const list = await app.request("/v1/projects", {
      headers: { cookie: underTest.session.cookie },
    });
    const projects = (await list.json()) as Array<{ key: string }>;

    expect(projects.map((project) => project.key)).toEqual([
      "alpha-platform",
      "alpha-platform-2",
    ]);

    // Each project still gets its own starter environments.
    const environments = await app.request(
      `/v1/projects/alpha-platform-2/environments`,
      { headers: { cookie: underTest.session.cookie } },
    );
    await expect(environments.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          key: "development",
          name: "Development",
          isDefault: true,
        }),
        expect.objectContaining({
          key: "production",
          name: "Production",
          isDefault: false,
        }),
      ],
    });
  });
});

describe("route coverage: environment seeding modes", () => {
  it("writes every flag disabled by default, and copies one when asked", async () => {
    const underTest = await fixture();
    await createFlag(underTest, "checkout-v2");

    // Turn the flag on in development, so a copy is distinguishable from the
    // disabled configuration every flag gets in a fresh environment.
    const published = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/environments/development`,
      {
        method: "PATCH",
        headers: headers(underTest.session),
        body: JSON.stringify({
          enabled: true,
          offVariation: "off",
          defaultVariation: "on",
          rolloutPercentage: 40,
          bucketBy: "userId",
        }),
      },
    );
    expect(published.status).toBe(200);

    const empty = await app.request(
      `/v1/projects/${underTest.projectKey}/environments`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({ name: "QA", key: "qa" }),
      },
    );
    expect(empty.status).toBe(201);
    const emptyDetail = (await empty.json()) as EnvironmentDetail;
    expect(emptyDetail.isProtected).toBe(false);

    // Every flag is configured here too, disabled rather than copied.
    const qa = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/environments/qa`,
      { headers: { cookie: underTest.session.cookie } },
    );
    expect(qa.status).toBe(200);
    await expect(qa.json()).resolves.toMatchObject({
      environmentKey: "qa",
      enabled: false,
      rolloutPercentage: 0,
    });

    const copied = await app.request(
      `/v1/projects/${underTest.projectKey}/environments`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({
          name: "Staging",
          key: "staging",
          initialFlagStatus: "copy-source",
          copyFrom: "development",
        }),
      },
    );
    expect(copied.status).toBe(201);

    const copy = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/environments/staging`,
      { headers: { cookie: underTest.session.cookie } },
    );
    expect(copy.status).toBe(200);

    const body = (await copy.json()) as FlagEnvironmentConfig;
    expect(body).toMatchObject({
      environmentKey: "staging",
      enabled: true,
      rolloutPercentage: 40,
    });

    // Variations are the flag's, not the copy's.
    const detail = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2`,
      { headers: { cookie: underTest.session.cookie } },
    );
    const flag = (await detail.json()) as FlagDetail;
    expect(flag.variations.map((variation) => variation.key)).toEqual([
      "on",
      "off",
    ]);
  });

  it("refuses copy-source without an environment to copy", async () => {
    const underTest = await fixture();

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/environments`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({
          name: "QA",
          key: "qa",
          initialFlagStatus: "copy-source",
        }),
      },
    );

    expect(response.status).toBe(400);
  });
});

describe("route coverage: audit range filters", () => {
  it("honours from and to", async () => {
    const underTest = await fixture();

    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    const within = await app.request(
      `/v1/projects/${underTest.projectKey}/audit-logs?from=${encodeURIComponent(past)}&to=${encodeURIComponent(future)}`,
      { headers: { cookie: underTest.session.cookie } },
    );
    const after = await app.request(
      `/v1/projects/${underTest.projectKey}/audit-logs?from=${encodeURIComponent(future)}`,
      { headers: { cookie: underTest.session.cookie } },
    );

    await expect(within.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ action: "project.created" })],
    });
    await expect(after.json()).resolves.toMatchObject({ data: [] });
  });
});

describe("route coverage: defensive reads", () => {
  it("falls back to defaults when the workspace metadata is not JSON", async () => {
    const underTest = await fixture();
    const { db } = await import("../db/client.js");
    const { organization } = await import("../db/schema/index.js");
    const { eq } = await import("drizzle-orm");

    await db
      .update(organization)
      .set({ metadata: "this is not json" })
      .where(eq(organization.id, underTest.organizationId));

    const profile = await app.request("/v1/workspace", {
      headers: { cookie: underTest.session.cookie },
    });
    const security = await app.request("/v1/workspace/security", {
      headers: { cookie: underTest.session.cookie },
    });

    expect(profile.status).toBe(200);
    const body = (await profile.json()) as WorkspaceProfile;
    expect(body.timezone).toBe("UTC");
    expect(body.defaultEnvironmentId).toBeNull();

    await expect(security.json()).resolves.toMatchObject({
      sessionTimeout: "24h",
      auditRetentionDays: 90,
    });
  });
});


describe("route coverage: archived flags", () => {
  async function archive(underTest: Fixture, key: string) {
    return app.request(`/v1/projects/${underTest.projectKey}/flags/${key}`, {
      method: "DELETE",
      headers: headers(underTest.session),
    });
  }

  async function unarchive(underTest: Fixture, key: string) {
    return app.request(
      `/v1/projects/${underTest.projectKey}/flags/${key}/unarchive`,
      { method: "POST", headers: headers(underTest.session) },
    );
  }

  it("freezes what the flag serves, then reopens it on restore", async () => {
    const underTest = await fixture();
    await createFlag(underTest, "checkout-v2");

    const flag = `/v1/projects/${underTest.projectKey}/flags/checkout-v2`;
    const config = `${flag}/environments/development`;

    expect((await archive(underTest, "checkout-v2")).status).toBe(200);

    const frozen = [
      {
        method: "PATCH",
        path: config,
        body: {
          enabled: true,
          offVariation: "off",
          defaultVariation: "on",
          rolloutPercentage: 100,
          bucketBy: "userId",
        },
      },
      { method: "PATCH", path: `${config}/enabled`, body: { enabled: true } },
      { method: "PUT", path: `${config}/rules`, body: { rules: [] } },
      { method: "PUT", path: `${config}/targets`, body: { targets: [] } },
      {
        method: "PUT",
        path: `${config}/targeting`,
        body: {
          rules: [],
          targets: [],
          config: {
            enabled: true,
            offVariation: "off",
            defaultVariation: "on",
            rolloutPercentage: 100,
            bucketBy: "userId",
          },
        },
      },
      {
        method: "POST",
        path: `${flag}/variations`,
        body: { key: "maybe", name: "Maybe", value: true },
      },
      { method: "PATCH", path: `${flag}/variations/on`, body: { name: "Later" } },
      { method: "DELETE", path: `${flag}/variations/off`, body: {} },
    ];

    for (const write of frozen) {
      const response = await app.request(write.path, {
        method: write.method,
        headers: headers(underTest.session),
        body: JSON.stringify(write.body),
      });

      expect(response.status, `${write.method} ${write.path}`).toBe(409);
    }

    // Reading is untouched, the identity is still editable, and a second
    // archive is refused rather than writing a second audit row.
    const read = await app.request(config, {
      headers: { cookie: underTest.session.cookie },
    });
    expect(read.status).toBe(200);

    const renamed = await app.request(flag, {
      method: "PATCH",
      headers: headers(underTest.session),
      body: JSON.stringify({ name: "Checkout v2 (archived)" }),
    });
    expect(renamed.status).toBe(200);

    expect((await archive(underTest, "checkout-v2")).status).toBe(409);

    expect((await unarchive(underTest, "checkout-v2")).status).toBe(200);
    expect((await unarchive(underTest, "checkout-v2")).status).toBe(409);

    const reopened = await app.request(`${config}/enabled`, {
      method: "PATCH",
      headers: headers(underTest.session),
      body: JSON.stringify({ enabled: true }),
    });
    expect(reopened.status).toBe(200);
  });
});
