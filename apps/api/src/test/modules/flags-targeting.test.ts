import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { FlagEnvironmentConfig } from "@iwifunni/contracts";

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

async function seedEnvironment(
  projectId: string,
  key: string,
): Promise<string> {
  const { db } = await import("../../db/client.js");
  const { environment } = await import("../../db/schema/index.js");
  const id = randomUUID();

  await db.insert(environment).values({ id, projectId, key, name: key });

  return id;
}

interface Fixture {
  session: TestSession;
  organizationId: string;
  projectKey: string;
  projectId: string;
  environmentId: string;
}

async function fixture(role = "owner"): Promise<Fixture> {
  const session = await signUp(app);
  const workspace = await seedWorkspace(session.userId, role);
  const project = await seedProject(workspace.organizationId);
  const environmentId = await seedEnvironment(project.projectId, "staging");

  return {
    session,
    organizationId: workspace.organizationId,
    projectKey: project.key,
    projectId: project.projectId,
    environmentId,
  };
}

/** A flag is project-scoped; its configuration in `staging` hangs off the flag. */
function flagPath(
  fixtureUnderTest: Fixture,
  flagKey: string,
  suffix = "",
): string {
  return `/v1/projects/${fixtureUnderTest.projectKey}/flags/${flagKey}${suffix}`;
}

function configPath(
  fixtureUnderTest: Fixture,
  flagKey: string,
  suffix = "",
): string {
  return `${flagPath(fixtureUnderTest, flagKey)}/environments/staging${suffix}`;
}

async function createFlag(fixtureUnderTest: Fixture, key: string) {
  return app.request(`/v1/projects/${fixtureUnderTest.projectKey}/flags`, {
    method: "POST",
    headers: headers(fixtureUnderTest.session),
    body: JSON.stringify({ key, name: key, type: "boolean" }),
  });
}

/** Rules may only reference segments that exist in the project. */
async function createSegment(fixtureUnderTest: Fixture, key: string) {
  const response = await app.request(
    `/v1/projects/${fixtureUnderTest.projectKey}/segments`,
    {
      method: "POST",
      headers: headers(fixtureUnderTest.session),
      body: JSON.stringify({ name: key, key, rules: [] }),
    },
  );

  expect(response.status).toBe(201);
}

async function readConfig(
  fixtureUnderTest: Fixture,
  flagKey: string,
): Promise<FlagEnvironmentConfig> {
  const response = await app.request(configPath(fixtureUnderTest, flagKey), {
    headers: { cookie: fixtureUnderTest.session.cookie },
  });

  expect(response.status).toBe(200);

  return (await response.json()) as FlagEnvironmentConfig;
}

const RULES = {
  rules: [
    {
      description: "Internal testers",
      conditions: [
        {
          attribute: "email",
          attributeType: "string",
          operator: "contains",
          values: ["@iwifunni.dev"],
        },
      ],
      variation: "on",
      segmentKeys: ["beta-users"],
    },
    {
      description: "Gradual rollout",
      conditions: [],
      variation: "on",
      segmentKeys: [],
      rollout: { percentage: 25, bucketBy: "userId" },
    },
  ],
};

describe("flags targeting", () => {
  it("stores ordered rules with conditions and a partial rollout", async () => {
    const underTest = await fixture();
    await createFlag(underTest, "checkout-v2");
    await createSegment(underTest, "beta-users");

    const path = configPath(underTest, "checkout-v2", "/rules");

    const replaced = await app.request(path, {
      method: "PUT",
      headers: headers(underTest.session),
      body: JSON.stringify(RULES),
    });

    expect(replaced.status).toBe(200);
    await expect(replaced.json()).resolves.toMatchObject([
      {
        description: "Internal testers",
        variation: "on",
        segmentKeys: ["beta-users"],
        conditions: [
          {
            attribute: "email",
            operator: "contains",
            values: ["@iwifunni.dev"],
          },
        ],
        rollout: null,
      },
      {
        description: "Gradual rollout",
        conditions: [],
        rollout: { percentage: 25, bucketBy: "userId" },
      },
    ]);

    const read = await app.request(path, {
      headers: { cookie: underTest.session.cookie },
    });
    const rules = (await read.json()) as Array<{ id: string }>;
    expect(rules).toHaveLength(2);

    // The environment's configuration embeds the same rules.
    const config = await readConfig(underTest, "checkout-v2");
    expect(config.rules).toHaveLength(2);
  });

  it("refuses a rule that serves a variation the flag does not define", async () => {
    const underTest = await fixture();
    await createFlag(underTest, "checkout-v2");

    const response = await app.request(
      configPath(underTest, "checkout-v2", "/rules"),
      {
        method: "PUT",
        headers: headers(underTest.session),
        body: JSON.stringify({
          rules: [{ variation: "maybe", conditions: [], segmentKeys: [] }],
        }),
      },
    );

    expect(response.status).toBe(400);
  });

  it("stores individual targets and returns them on the configuration", async () => {
    const underTest = await fixture();
    await createFlag(underTest, "checkout-v2");

    const path = configPath(underTest, "checkout-v2", "/targets");

    const replaced = await app.request(path, {
      method: "PUT",
      headers: headers(underTest.session),
      body: JSON.stringify({
        targets: [{ userId: "user-42", variationKey: "on" }],
      }),
    });

    expect(replaced.status).toBe(200);
    await expect(replaced.json()).resolves.toEqual([
      { userId: "user-42", variationKey: "on" },
    ]);

    const config = await readConfig(underTest, "checkout-v2");

    expect(config.individualTargets).toEqual([
      { userId: "user-42", variationKey: "on" },
    ]);
  });

  it("publishes rules, targets and the served default as one version", async () => {
    const underTest = await fixture();
    await createFlag(underTest, "checkout-v2");
    await createSegment(underTest, "beta-users");

    const published = await app.request(
      configPath(underTest, "checkout-v2", "/targeting"),
      {
        method: "PUT",
        headers: headers(underTest.session),
        body: JSON.stringify({
          rules: RULES.rules,
          targets: [{ userId: "user-42", variationKey: "on" }],
          config: {
            enabled: true,
            offVariation: "off",
            defaultVariation: "on",
            rolloutPercentage: 25,
            bucketBy: "userId",
          },
        }),
      },
    );

    expect(published.status).toBe(200);
    await expect(published.json()).resolves.toMatchObject({
      enabled: true,
      rolloutPercentage: 25,
      rules: [
        {
          description: "Internal testers",
          segmentKeys: ["beta-users"],
          conditions: [
            {
              attribute: "email",
              operator: "contains",
              values: ["@iwifunni.dev"],
            },
          ],
        },
        { rollout: { percentage: 25, bucketBy: "userId" } },
      ],
      individualTargets: [{ userId: "user-42", variationKey: "on" }],
    });

    // All three collections land as one publish, so the history gains one
    // version and the audit log one row rather than three of each.
    const versions = await app.request(
      configPath(underTest, "checkout-v2", "/versions"),
      { headers: { cookie: underTest.session.cookie } },
    );
    const history = (await versions.json()) as {
      data: Array<{ version: number }>;
    };

    expect(history.data.map((entry) => entry.version)).toEqual([2, 1]);

    const { db } = await import("../../db/client.js");
    const { auditLog } = await import("../../db/schema/index.js");
    const actions = (await db.select().from(auditLog)).map((row) => row.action);

    expect(actions.filter((action) => action === "flag.updated")).toHaveLength(1);
  });

  it("refuses a targeting publish that names an unknown segment, writing nothing", async () => {
    const underTest = await fixture();
    await createFlag(underTest, "checkout-v2");

    const response = await app.request(
      configPath(underTest, "checkout-v2", "/targeting"),
      {
        method: "PUT",
        headers: headers(underTest.session),
        body: JSON.stringify({
          rules: [{ variation: "on", conditions: [], segmentKeys: ["ghost"] }],
          targets: [{ userId: "user-42", variationKey: "on" }],
        }),
      },
    );

    expect(response.status).toBe(400);

    const config = await readConfig(underTest, "checkout-v2");

    expect(config.rules).toEqual([]);
    expect(config.individualTargets).toEqual([]);
  });

  it("lists versions newest first, one per publish", async () => {
    const underTest = await fixture();
    await createFlag(underTest, "checkout-v2");
    await createSegment(underTest, "beta-users");

    await app.request(configPath(underTest, "checkout-v2"), {
      method: "PATCH",
      headers: headers(underTest.session),
      body: JSON.stringify({
        enabled: true,
        offVariation: "off",
        defaultVariation: "on",
        rolloutPercentage: 10,
        bucketBy: "userId",
      }),
    });

    await app.request(configPath(underTest, "checkout-v2", "/rules"), {
      method: "PUT",
      headers: headers(underTest.session),
      body: JSON.stringify(RULES),
    });

    const response = await app.request(
      configPath(underTest, "checkout-v2", "/versions"),
      { headers: { cookie: underTest.session.cookie } },
    );

    const body = (await response.json()) as {
      data: Array<{ version: number; serve: string | null }>;
      nextCursor: string | null;
    };

    expect(body.data.map((entry) => entry.version)).toEqual([3, 2, 1]);
    // The newest publish was the rule set, which serves no single variation;
    // the configuration publish before it served the default variation.
    expect(body.data[0]?.serve).toBeNull();
    expect(body.data[1]?.serve).toBe("on");
    expect(body.nextCursor).toBeNull();
  });

  it("builds the dependency graph for the flag", async () => {
    const underTest = await fixture();
    await createFlag(underTest, "checkout-v2");

    const { db } = await import("../../db/client.js");
    const { flag, flagDependency } = await import("../../db/schema/index.js");

    for (const key of ["accounts-service", "search-v2"]) {
      await db.insert(flag).values({
        id: randomUUID(),
        projectId: underTest.projectId,
        key,
        name: key,
        type: "boolean",
      });
    }

    await db.insert(flagDependency).values([
      {
        id: randomUUID(),
        projectId: underTest.projectId,
        key: "checkout-v2",
        requires: "accounts-service",
        referencedIn: null,
      },
      {
        id: randomUUID(),
        projectId: underTest.projectId,
        key: "search-v2",
        requires: "checkout-v2",
        referencedIn: null,
      },
    ]);

    const response = await app.request(
      flagPath(underTest, "checkout-v2", "/dependencies"),
      { headers: { cookie: underTest.session.cookie } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      upstream: ["accounts-service"],
      downstream: ["search-v2"],
      summary: { upstream: 1, downstream: 1, circular: false },
      evaluationOrder: [
        { key: "accounts-service", isSelf: false },
        { key: "checkout-v2", isSelf: true },
        { key: "search-v2", isSelf: false },
      ],
    });
  });
});

describe("workspace-wide flag list", () => {
  it("returns flags from every project in the workspace with their project key", async () => {
    const session = await signUp(app);
    const workspace = await seedWorkspace(session.userId, "owner");
    const first = await seedProject(workspace.organizationId, "First");
    const second = await seedProject(workspace.organizationId, "Second");

    for (const project of [first, second]) {
      await seedEnvironment(project.projectId, "staging");
      const response = await app.request(`/v1/projects/${project.key}/flags`, {
        method: "POST",
        headers: headers(session),
        body: JSON.stringify({
          key: "shared-key",
          name: "Shared",
          type: "boolean",
        }),
      });
      expect(response.status).toBe(201);
    }

    const response = await app.request("/v1/flags", {
      headers: { cookie: session.cookie },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ key: string; projectKey: string }>;
    };

    expect(body.data).toHaveLength(2);
    expect(body.data.map((row) => row.projectKey).sort()).toEqual(
      [first.key, second.key].sort(),
    );

    // The same key exists twice, so resolution requires the project key.
    const ambiguous = await app.request("/v1/flags/shared-key", {
      headers: { cookie: session.cookie },
    });
    expect(ambiguous.status).toBe(400);

    const resolved = await app.request(
      `/v1/flags/shared-key?projectKey=${second.key}&environmentKey=staging`,
      { headers: { cookie: session.cookie } },
    );
    expect(resolved.status).toBe(200);
    await expect(resolved.json()).resolves.toMatchObject({
      key: "shared-key",
      projectId: second.projectId,
      environments: [
        expect.objectContaining({ environmentKey: "staging" }),
      ],
    });
  });

  it("never lists another workspace's flags", async () => {
    const ours = await fixture();
    await createFlag(ours, "checkout-v2");

    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");

    const response = await app.request("/v1/flags", {
      headers: { cookie: outsider.cookie },
    });

    await expect(response.json()).resolves.toMatchObject({ data: [] });
  });
});
