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
  it("rolls back once only after enough outcomes for the armed version exceed the threshold", async () => {
    const test = await fixture();
    await createFlag(test, "guarded");
    const path = configPath(test, "guarded");
    const config = {
      enabled: true,
      offVariation: "off",
      defaultVariation: "on",
      rolloutPercentage: 100,
      bucketBy: "userId",
    };
    expect(
      (
        await app.request(path, {
          method: "PATCH",
          headers: headers(test.session),
          body: JSON.stringify(config),
        })
      ).status,
    ).toBe(200);
    const armed = await app.request(`${path}/rollback-policies`, {
      method: "POST",
      headers: headers(test.session),
      body: JSON.stringify({
        currentVersion: 2,
        targetVersion: 1,
        errorPercentage: 50,
        minimumSamples: 10,
        windowMinutes: 5,
      }),
    });
    expect(armed.status).toBe(201);
    const issued = await app.request(
      `/v1/projects/${test.projectKey}/api-keys`,
      {
        method: "POST",
        headers: headers(test.session),
        body: JSON.stringify({
          name: "Outcomes",
          kind: "server",
          environmentKey: "staging",
          scopes: ["flags:read", "events:write"],
        }),
      },
    );
    expect(issued.status).toBe(201);
    const key = (await issued.json()) as { secret: string };
    async function report(version: number, count: number) {
      const response = await app.request("/v1/sdk/events", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          events: Array.from({ length: count }, () => ({
            id: randomUUID(),
            flagKey: "guarded",
            flagVersion: version,
            kind: "outcome",
            outcome: "error",
            variation: "on",
            reason: "default_variation",
            latencyMs: 0,
          })),
        }),
      });
      expect(response.status).toBe(202);
    }
    const { runFlagRollbackPolicies } = await import("../../app.js");
    const now = Date.now();
    await report(1, 10);
    await runFlagRollbackPolicies(new Date(now + 1000));
    expect((await readConfig(test, "guarded")).enabled).toBe(true);
    await report(2, 9);
    await runFlagRollbackPolicies(new Date(now + 17000));
    expect((await readConfig(test, "guarded")).enabled).toBe(true);
    await report(2, 1);
    const runs = await Promise.all([
      runFlagRollbackPolicies(new Date(now + 33000)),
      runFlagRollbackPolicies(new Date(now + 33000)),
    ]);
    expect(runs.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect((await readConfig(test, "guarded")).enabled).toBe(false);
    const policies = await app.request(`${path}/rollback-policies`, {
      headers: headers(test.session),
    });
    await expect(policies.json()).resolves.toMatchObject({
      data: [{ status: "triggered" }],
    });
    const versions = await app.request(`${path}/versions`, {
      headers: headers(test.session),
    });
    await expect(versions.json()).resolves.toMatchObject({
      data: [
        { version: 3, description: "Automatically restored version 1" },
        { version: 2 },
        { version: 1 },
      ],
    });
    const inbox = await app.request("/v1/notifications", {
      headers: headers(test.session),
    });
    await expect(inbox.json()).resolves.toMatchObject({
      data: [{ action: "flag.automatically_rolled_back", read: false }],
    });
  });

  it("blocks rollback after a newer publish or protection change and hides policies across tenants", async () => {
    const test = await fixture();
    await createFlag(test, "guarded");
    const path = configPath(test, "guarded");
    const config = {
      enabled: true,
      offVariation: "off",
      defaultVariation: "on",
      rolloutPercentage: 100,
      bucketBy: "userId",
    };
    await app.request(path, {
      method: "PATCH",
      headers: headers(test.session),
      body: JSON.stringify(config),
    });
    const arm = (currentVersion: number) =>
      app.request(`${path}/rollback-policies`, {
        method: "POST",
        headers: headers(test.session),
        body: JSON.stringify({
          currentVersion,
          targetVersion: 1,
          errorPercentage: 50,
          minimumSamples: 10,
          windowMinutes: 5,
        }),
      });
    expect((await arm(2)).status).toBe(201);
    await app.request(path, {
      method: "PATCH",
      headers: headers(test.session),
      body: JSON.stringify({ ...config, rolloutPercentage: 75 }),
    });
    const { runFlagRollbackPolicies } = await import("../../app.js");
    await runFlagRollbackPolicies();
    expect((await readConfig(test, "guarded")).rolloutPercentage).toBe(75);
    expect((await arm(3)).status).toBe(201);
    const { db } = await import("../../db/client.js");
    const { environment } = await import("../../db/schema/index.js");
    const { eq } = await import("drizzle-orm");
    await db
      .update(environment)
      .set({ isProtected: true })
      .where(eq(environment.id, test.environmentId));
    await runFlagRollbackPolicies();
    const policies = await app.request(`${path}/rollback-policies`, {
      headers: headers(test.session),
    });
    const body = (await policies.json()) as { data: Array<{ status: string }> };
    expect(body.data.map((row) => row.status)).toEqual(["blocked", "blocked"]);
    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");
    expect(
      (
        await app.request(`${path}/rollback-policies`, {
          headers: headers(outsider),
        })
      ).status,
    ).toBe(404);
    expect((await arm(3)).status).toBe(409);
  });

  it("runs a due schedule once across competing workers and preserves newer manual publishes", async () => {
    const test = await fixture();
    await createFlag(test, "checkout-v2");
    const executeAt = new Date(Date.now() + 120_000).toISOString();
    const input = {
      executeAt,
      baseVersion: 1,
      payload: {
        config: {
          enabled: true,
          offVariation: "off",
          defaultVariation: "on",
          rolloutPercentage: 25,
          bucketBy: "userId",
        },
      },
    };
    const response = await app.request(
      configPath(test, "checkout-v2", "/schedules"),
      {
        method: "POST",
        headers: headers(test.session),
        body: JSON.stringify(input),
      },
    );
    expect(response.status).toBe(201);
    const { runDueFlagSchedules } = await import("../../app.js");
    expect(await runDueFlagSchedules(new Date())).toBe(0);
    const runs = await Promise.all([
      runDueFlagSchedules(new Date(executeAt)),
      runDueFlagSchedules(new Date(executeAt)),
    ]);
    expect(runs.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await readConfig(test, "checkout-v2")).toMatchObject({
      enabled: true,
      rolloutPercentage: 25,
    });
    const second = await app.request(
      configPath(test, "checkout-v2", "/schedules"),
      {
        method: "POST",
        headers: headers(test.session),
        body: JSON.stringify({ ...input, baseVersion: 2 }),
      },
    );
    expect(second.status).toBe(201);
    const manual = await app.request(configPath(test, "checkout-v2"), {
      method: "PATCH",
      headers: headers(test.session),
      body: JSON.stringify({ ...input.payload.config, rolloutPercentage: 70 }),
    });
    expect(manual.status).toBe(200);
    await runDueFlagSchedules(new Date(executeAt));
    expect(await readConfig(test, "checkout-v2")).toMatchObject({
      rolloutPercentage: 70,
    });
    const list = await app.request(
      configPath(test, "checkout-v2", "/schedules"),
      { headers: headers(test.session) },
    );
    const body = (await list.json()) as { data: { status: string }[] };
    expect(body.data.map((row) => row.status).sort()).toEqual([
      "completed",
      "failed",
    ]);
  });

  it("rejects stale scheduling, allows cancellation and rechecks protection when due", async () => {
    const test = await fixture();
    await createFlag(test, "checkout-v2");
    const executeAt = new Date(Date.now() + 120_000).toISOString();
    const input = {
      executeAt,
      baseVersion: 1,
      payload: {
        targets: { targets: [{ userId: "tester", variationKey: "on" }] },
      },
    };
    const create = () =>
      app.request(configPath(test, "checkout-v2", "/schedules"), {
        method: "POST",
        headers: headers(test.session),
        body: JSON.stringify(input),
      });
    const cancelled = await create();
    const row = (await cancelled.json()) as { id: string };
    const cancellation = await app.request(
      configPath(test, "checkout-v2", `/schedules/${row.id}`),
      { method: "DELETE", headers: headers(test.session) },
    );
    expect(cancellation.status).toBe(204);
    expect((await create()).status).toBe(201);
    const { db } = await import("../../db/client.js");
    const { environment } = await import("../../db/schema/index.js");
    const { eq } = await import("drizzle-orm");
    await db
      .update(environment)
      .set({ isProtected: true })
      .where(eq(environment.id, test.environmentId));
    const { runDueFlagSchedules } = await import("../../app.js");
    expect(await runDueFlagSchedules(new Date(executeAt))).toBe(1);
    expect((await readConfig(test, "checkout-v2")).individualTargets).toEqual(
      [],
    );
    expect((await create()).status).toBe(409);
    const list = await app.request(
      configPath(test, "checkout-v2", "/schedules"),
      { headers: headers(test.session) },
    );
    const body = (await list.json()) as {
      data: { status: string; failureReason: string | null }[];
    };
    expect(body.data.map((row) => row.status).sort()).toEqual([
      "cancelled",
      "failed",
    ]);
    expect(
      body.data.find((row) => row.status === "failed")?.failureReason,
    ).toContain("protected environment");
  });

  it("captures complete releases and restores configuration, rules and targets atomically", async () => {
    const test = await fixture();
    await createFlag(test, "checkout-v2");
    await createSegment(test, "beta-users");
    const original = await readConfig(test, "checkout-v2");
    const publish = await app.request(
      configPath(test, "checkout-v2", "/targeting"),
      {
        method: "PUT",
        headers: headers(test.session),
        body: JSON.stringify({
          ...RULES,
          targets: [{ userId: "tester-1", variationKey: "on" }],
          config: {
            enabled: true,
            offVariation: "off",
            defaultVariation: "on",
            rolloutPercentage: 35,
            bucketBy: "userId",
          },
        }),
      },
    );
    expect(publish.status).toBe(200);
    const detail = await app.request(
      configPath(test, "checkout-v2", "/versions/2"),
      { headers: headers(test.session) },
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      state: {
        config: { enabled: true, rolloutPercentage: 35 },
        rules: {
          rules: [
            { description: "Internal testers" },
            { description: "Gradual rollout" },
          ],
        },
        targets: { targets: [{ userId: "tester-1", variationKey: "on" }] },
      },
    });
    const restored = await app.request(
      configPath(test, "checkout-v2", "/versions/1/restore"),
      { method: "POST", headers: headers(test.session) },
    );
    expect(restored.status).toBe(204);
    expect(await readConfig(test, "checkout-v2")).toEqual(original);
    const versions = await app.request(
      configPath(test, "checkout-v2", "/versions"),
      { headers: headers(test.session) },
    );
    await expect(versions.json()).resolves.toMatchObject({
      data: [
        { version: 3, description: "Restored version 1" },
        { version: 2 },
        { version: 1 },
      ],
    });
  });

  it("keeps version reads and restores tenant isolated and validates version numbers", async () => {
    const test = await fixture();
    await createFlag(test, "checkout-v2");
    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");
    for (const [suffix, method] of [
      ["/versions/1", "GET"],
      ["/versions/1/restore", "POST"],
    ]) {
      const response = await app.request(
        configPath(test, "checkout-v2", suffix),
        { method, headers: headers(outsider) },
      );
      expect(response.status).toBe(404);
    }
    const invalid = await app.request(
      configPath(test, "checkout-v2", "/versions/nope"),
      { headers: headers(test.session) },
    );
    expect(invalid.status).toBe(400);
    const { db } = await import("../../db/client.js");
    const { environment } = await import("../../db/schema/index.js");
    const { eq } = await import("drizzle-orm");
    await db
      .update(environment)
      .set({ isProtected: true })
      .where(eq(environment.id, test.environmentId));
    const protectedRestore = await app.request(
      configPath(test, "checkout-v2", "/versions/1/restore"),
      { method: "POST", headers: headers(test.session) },
    );
    expect(protectedRestore.status).toBe(409);
    await expect(protectedRestore.json()).resolves.toMatchObject({
      error: { code: "approval_required" },
    });
  });

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

    expect(actions.filter((action) => action === "flag.updated")).toHaveLength(
      1,
    );
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
      environments: [expect.objectContaining({ environmentKey: "staging" })],
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
