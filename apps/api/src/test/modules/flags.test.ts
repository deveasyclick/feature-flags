import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type {
  FlagDetail,
  FlagEnvironmentConfig,
  FlagSummary,
  FlagVersion,
} from "@iwifunni/contracts";

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

async function seedEnvironment(
  projectId: string,
  key: string,
  name: string,
): Promise<string> {
  const { db } = await import("../../db/client.js");
  const { environment } = await import("../../db/schema/index.js");
  const id = randomUUID();

  await db.insert(environment).values({ id, projectId, key, name });

  return id;
}

async function seedProjectMember(
  projectId: string,
  userId: string,
  role: string,
): Promise<void> {
  const { db } = await import("../../db/client.js");
  const { projectMember } = await import("../../db/schema/index.js");

  await db
    .insert(projectMember)
    .values({ id: randomUUID(), projectId, userId, role });
}

async function ownerFixture(): Promise<{
  session: TestSession;
  organizationId: string;
  projectKey: string;
  projectId: string;
}> {
  const session = await signUp(app);
  const workspace = await seedWorkspace(session.userId, "owner");
  const project = await seedProject(workspace.organizationId);

  return {
    session,
    organizationId: workspace.organizationId,
    projectKey: project.key,
    projectId: project.projectId,
  };
}

function headers(session: TestSession): Record<string, string> {
  return { "content-type": "application/json", cookie: session.cookie };
}

/** A flag is project-scoped: its key alone addresses it inside the project. */
function flagPath(projectKey: string, flagKey: string): string {
  return `/v1/projects/${projectKey}/flags/${flagKey}`;
}

/** What one flag does in one environment hangs off the flag. */
function configPath(
  projectKey: string,
  flagKey: string,
  environmentKey: string,
): string {
  return `${flagPath(projectKey, flagKey)}/environments/${environmentKey}`;
}

function createFlag(
  projectKey: string,
  session: TestSession,
  body: Record<string, unknown>,
) {
  return app.request(`/v1/projects/${projectKey}/flags`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ tags: [], ...body }),
  });
}

const CONFIG = {
  enabled: true,
  offVariation: "off",
  defaultVariation: "on",
  rolloutPercentage: 0,
  bucketBy: "userId",
};

function publishConfig(
  session: TestSession,
  projectKey: string,
  flagKey: string,
  environmentKey: string,
  overrides: Record<string, unknown> = {},
) {
  return app.request(configPath(projectKey, flagKey, environmentKey), {
    method: "PATCH",
    headers: headers(session),
    body: JSON.stringify({ ...CONFIG, ...overrides }),
  });
}

async function readConfig(
  session: TestSession,
  projectKey: string,
  flagKey: string,
  environmentKey: string,
): Promise<FlagEnvironmentConfig> {
  const response = await app.request(
    configPath(projectKey, flagKey, environmentKey),
    { headers: { cookie: session.cookie } },
  );

  expect(response.status).toBe(200);

  return (await response.json()) as FlagEnvironmentConfig;
}

async function versionNumbers(
  session: TestSession,
  projectKey: string,
  flagKey: string,
  environmentKey: string,
): Promise<number[]> {
  const response = await app.request(
    `${configPath(projectKey, flagKey, environmentKey)}/versions`,
    { headers: { cookie: session.cookie } },
  );

  expect(response.status).toBe(200);
  const page = (await response.json()) as { data: FlagVersion[] };

  return page.data.map((entry) => entry.version);
}

describe("flags module", () => {
  it("creates the flag with the values the caller chose, ignoring a variation description", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "development", "Development");

    const created = await createFlag(projectKey, session, {
      key: "greeting",
      name: "Greeting",
      type: "string",
      variations: [
        { key: "on", value: "hello", description: "the friendly one" },
        { key: "off", value: "goodbye" },
      ],
      defaultVariation: "on",
      offVariation: "off",
    });

    expect(created.status).toBe(201);
    const detail = (await created.json()) as FlagDetail;

    expect(detail.environments).toEqual([
      {
        environmentKey: "development",
        environmentName: "Development",
        enabled: false,
        rolloutPercentage: 0,
      },
    ]);
    expect(
      detail.variations.find((variation) => variation.key === "on")?.value,
    ).toBe("hello");
    expect(
      detail.variations.find((variation) => variation.key === "off")?.value,
    ).toBe("goodbye");
    // A creation variation carries no description: the contract strips the
    // extra key, and the variation reads back with the column's null.
    expect(detail.variations.map((variation) => variation.description)).toEqual([
      null,
      null,
    ]);
  });

  it("answers an environment the project does not have with 404", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "development", "Development");

    const created = await createFlag(projectKey, session, {
      key: "greeting",
      name: "Greeting",
      type: "boolean",
    });
    expect(created.status).toBe(201);

    const read = await app.request(
      configPath(projectKey, "greeting", "production"),
      { headers: { cookie: session.cookie } },
    );
    expect(read.status).toBe(404);

    const write = await publishConfig(
      session,
      projectKey,
      "greeting",
      "production",
    );
    expect(write.status).toBe(404);
  });

  it("refuses creation when a chosen value is not the declared type", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "development", "Development");

    const created = await createFlag(projectKey, session, {
      key: "greeting",
      name: "Greeting",
      type: "string",
      variations: [
        { key: "on", value: true },
        { key: "off", value: "goodbye" },
      ],
      defaultVariation: "on",
      offVariation: "off",
    });

    expect(created.status).toBe(400);
    await expect(created.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
    });

    // Nothing was written, so the key is still free.
    const retried = await createFlag(projectKey, session, {
      key: "greeting",
      name: "Greeting",
      type: "string",
      variations: [
        { key: "on", value: "hello" },
        { key: "off", value: "goodbye" },
      ],
      defaultVariation: "on",
      offVariation: "off",
    });
    expect(retried.status).toBe(201);
  });

  it("starts a flag with values of its declared type", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "development", "Development");

    const seeded = async (key: string, type: string) => {
      const response = await createFlag(projectKey, session, {
        key,
        name: key,
        type,
      });

      expect(response.status).toBe(201);
      const detail = (await response.json()) as FlagDetail;

      return {
        on: detail.variations.find((variation) => variation.key === "on")
          ?.value,
        off: detail.variations.find((variation) => variation.key === "off")
          ?.value,
      };
    };

    // The point of the type: a string flag serves strings from its first
    // evaluation, rather than the boolean pair every flag used to get.
    expect(await seeded("greeting", "string")).toEqual({
      on: "on",
      off: "off",
    });
    expect(await seeded("retries", "number")).toEqual({ on: 1, off: 0 });
    expect(await seeded("enabled", "boolean")).toEqual({ on: true, off: false });

    const asJson = await seeded("payload", "json");
    expect(typeof asJson.on).toBe("object");
    expect(typeof asJson.off).toBe("object");
  });

  it("refuses a variation value that is not the flag's declared type", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "development", "Development");

    const created = await createFlag(projectKey, session, {
      key: "greeting",
      name: "Greeting",
      type: "string",
    });
    expect(created.status).toBe(201);

    const add = (value: unknown) =>
      app.request(`${flagPath(projectKey, "greeting")}/variations`, {
        method: "POST",
        headers: headers(session),
        body: JSON.stringify({ key: "custom", name: "Custom", value }),
      });

    const rejected = await add(true);
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
    });

    // A matching value goes through, so the rule is the type and not a blanket
    // refusal of the endpoint.
    expect((await add("hello")).status).toBe(201);
  });

  it("keeps configuration per environment and records one audit row per mutation", async () => {
    const { session, organizationId, projectKey, projectId } =
      await ownerFixture();

    const staging = await seedEnvironment(projectId, "staging", "Staging");
    await seedEnvironment(projectId, "production", "Production");

    const created = await createFlag(projectKey, session, {
      key: "checkout-v2",
      name: "Checkout v2",
      type: "boolean",
      tags: ["release"],
    });

    expect(created.status).toBe(201);

    const published = await publishConfig(
      session,
      projectKey,
      "checkout-v2",
      "staging",
      { rolloutPercentage: 50 },
    );

    expect(published.status).toBe(200);
    await expect(published.json()).resolves.toMatchObject({
      environmentKey: "staging",
      enabled: true,
      rolloutPercentage: 50,
    });

    // The flag exists in production, and publishing in staging left it alone.
    const production = await readConfig(
      session,
      projectKey,
      "checkout-v2",
      "production",
    );
    expect(production).toMatchObject({
      environmentKey: "production",
      enabled: false,
      rolloutPercentage: 0,
    });

    const { db } = await import("../../db/client.js");
    const { auditLog, flagVersion } = await import("../../db/schema/index.js");

    const audits = await db.select().from(auditLog);
    expect(audits.map((row) => row.action).sort()).toEqual([
      "flag.created",
      "flag.enabled",
    ]);
    expect(audits.every((row) => row.organizationId === organizationId)).toBe(
      true,
    );
    expect(
      audits.find((row) => row.action === "flag.enabled")?.environmentId,
    ).toBe(staging);

    // Each environment starts at v1; the publish adds one more, in staging only.
    await expect(db.select().from(flagVersion)).resolves.toHaveLength(3);
  });

  it("answers a project in another workspace with 404", async () => {
    const { projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "development", "Development");
    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");

    const response = await app.request(
      `/v1/projects/${projectKey}/flags?environmentKey=development`,
      { headers: { cookie: outsider.cookie } },
    );

    expect(response.status).toBe(404);
  });

  it("lets a viewer read but not write", async () => {
    const { session, organizationId, projectKey, projectId } =
      await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");

    const viewer = await signUp(app);
    await seedProjectMember(projectId, viewer.userId, "viewer");
    const { db } = await import("../../db/client.js");
    const { member } = await import("../../db/schema/index.js");
    await db
      .insert(member)
      .values({
        id: randomUUID(),
        organizationId,
        userId: viewer.userId,
        role: "member",
      });

    const created = await createFlag(projectKey, session, {
      key: "beta",
      name: "Beta",
      type: "boolean",
    });
    expect(created.status).toBe(201);

    const list = await app.request(
      `/v1/projects/${projectKey}/flags?environmentKey=staging`,
      { headers: { cookie: viewer.cookie } },
    );
    expect(list.status).toBe(200);

    const write = await publishConfig(viewer, projectKey, "beta", "staging");
    expect(write.status).toBe(403);
  });

  it("switches a flag on at full rollout and off without losing the percentage", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");

    await createFlag(projectKey, session, {
      key: "beta",
      name: "Beta",
      type: "boolean",
    });

    const toggle = (enabled: boolean) =>
      app.request(`${configPath(projectKey, "beta", "staging")}/enabled`, {
        method: "PATCH",
        headers: headers(session),
        body: JSON.stringify({ enabled }),
      });

    // Switching on rolls out in full: 0% means "serve nobody", so landing there
    // by default would leave the flag on in name only.
    const on = await toggle(true);
    expect(on.status).toBe(200);
    await expect(on.json()).resolves.toMatchObject({
      environmentKey: "staging",
      enabled: true,
      rolloutPercentage: 100,
    });

    // A deliberate partial rollout is the publish endpoint's business, not the
    // toggle's; the switch must leave it alone.
    const partial = await publishConfig(session, projectKey, "beta", "staging", {
      rolloutPercentage: 40,
    });
    expect(partial.status).toBe(200);

    const off = await toggle(false);
    expect(off.status).toBe(200);
    await expect(off.json()).resolves.toMatchObject({
      enabled: false,
      rolloutPercentage: 40,
    });

    // And switching back on resumes at 100% rather than the stored 40%.
    const backOn = await toggle(true);
    await expect(backOn.json()).resolves.toMatchObject({
      enabled: true,
      rolloutPercentage: 100,
    });
  });

  it("refuses the toggle in a protected environment", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");

    await createFlag(projectKey, session, {
      key: "beta",
      name: "Beta",
      type: "boolean",
    });

    const protectedResponse = await app.request(
      `/v1/projects/${projectKey}/environments/staging/settings`,
      {
        method: "PATCH",
        headers: headers(session),
        body: JSON.stringify({ isProtected: true }),
      },
    );
    expect(protectedResponse.status).toBe(200);

    const response = await app.request(
      `${configPath(projectKey, "beta", "staging")}/enabled`,
      {
        method: "PATCH",
        headers: headers(session),
        body: JSON.stringify({ enabled: true }),
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "approval_required" },
    });
  });

  it("refuses the toggle from a viewer", async () => {
    const { session, organizationId, projectKey, projectId } =
      await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");

    const viewer = await signUp(app);
    await seedProjectMember(projectId, viewer.userId, "viewer");
    const { db } = await import("../../db/client.js");
    const { member } = await import("../../db/schema/index.js");
    await db.insert(member).values({
      id: randomUUID(),
      organizationId,
      userId: viewer.userId,
      role: "member",
    });

    await createFlag(projectKey, session, {
      key: "beta",
      name: "Beta",
      type: "boolean",
    });

    const response = await app.request(
      `${configPath(projectKey, "beta", "staging")}/enabled`,
      {
        method: "PATCH",
        headers: headers(viewer),
        body: JSON.stringify({ enabled: true }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("refuses a duplicate flag key with 409", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");
    await seedEnvironment(projectId, "production", "Production");

    const body = {
      key: "beta",
      name: "Beta",
      type: "boolean",
    };

    const first = await createFlag(projectKey, session, body);
    expect(first.status).toBe(201);

    // The key is unique across the project, not per environment.
    const elsewhere = await createFlag(projectKey, session, body);
    expect(elsewhere.status).toBe(409);
    await expect(elsewhere.json()).resolves.toMatchObject({
      error: { code: "conflict" },
    });
  });

  it("lists a project-scoped flag exactly once in the project and workspace lists", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");
    await seedEnvironment(projectId, "production", "Production");

    await createFlag(projectKey, session, {
      key: "beta",
      name: "Beta",
      type: "boolean",
    });

    const projectList = await app.request(
      `/v1/projects/${projectKey}/flags`,
      { headers: { cookie: session.cookie } },
    );
    const projectBody = (await projectList.json()) as { data: FlagSummary[] };

    expect(projectBody.data).toHaveLength(1);
    expect(
      projectBody.data[0]?.environments.map((entry) => entry.environmentKey),
    ).toEqual(["staging", "production"]);

    const workspaceList = await app.request("/v1/flags", {
      headers: { cookie: session.cookie },
    });
    const workspaceBody = (await workspaceList.json()) as { data: FlagSummary[] };

    expect(workspaceBody.data).toHaveLength(1);
    expect(workspaceBody.data[0]?.key).toBe("beta");
  });

  it("rejects a variation that the flag does not define", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");

    await createFlag(projectKey, session, {
      key: "beta",
      name: "Beta",
      type: "boolean",
    });

    const response = await publishConfig(
      session,
      projectKey,
      "beta",
      "staging",
      { defaultVariation: "missing" },
    );

    expect(response.status).toBe(400);
  });

  it("filters the list by search and status", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");

    for (const [key, name] of [
      ["checkout-v2", "Checkout v2"],
      ["search-bar", "Search bar"],
    ] as const) {
      await createFlag(projectKey, session, { key, name, type: "boolean" });
    }

    const searched = await app.request(
      `/v1/projects/${projectKey}/flags?environmentKey=staging&search=checkout`,
      { headers: { cookie: session.cookie } },
    );
    const body = (await searched.json()) as { data: FlagSummary[] };

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.key).toBe("checkout-v2");

    await app.request(flagPath(projectKey, "search-bar"), {
      method: "DELETE",
      headers: { cookie: session.cookie },
    });

    const active = await app.request(
      `/v1/projects/${projectKey}/flags?environmentKey=staging&status=active`,
      { headers: { cookie: session.cookie } },
    );
    const archived = await app.request(
      `/v1/projects/${projectKey}/flags?environmentKey=staging&status=archived`,
      { headers: { cookie: session.cookie } },
    );

    await expect(active.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ key: "checkout-v2" })],
    });
    await expect(archived.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ key: "search-bar" })],
    });
  });

  it("configures a new flag in every environment with its own first history entry", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");
    await seedEnvironment(projectId, "production", "Production");

    const created = await createFlag(projectKey, session, {
      key: "checkout-v2",
      name: "Checkout v2",
      type: "boolean",
    });
    expect(created.status).toBe(201);

    const detail = (await created.json()) as FlagDetail;
    expect(
      detail.environments.map((entry) => entry.environmentKey).sort(),
    ).toEqual(["production", "staging"]);

    for (const environmentKey of ["staging", "production"]) {
      const config = await readConfig(
        session,
        projectKey,
        "checkout-v2",
        environmentKey,
      );

      expect(config).toMatchObject({
        environmentKey,
        enabled: false,
        offVariation: "off",
        defaultVariation: "on",
        rolloutPercentage: 0,
        rules: [],
        individualTargets: [],
      });

      const response = await app.request(
        `${configPath(projectKey, "checkout-v2", environmentKey)}/versions`,
        { headers: { cookie: session.cookie } },
      );
      const page = (await response.json()) as { data: FlagVersion[] };

      expect(page.data).toHaveLength(1);
      expect(page.data[0]).toMatchObject({
        version: 1,
        description: "Flag created",
        environmentKey,
      });
    }

    const { db } = await import("../../db/client.js");
    const { flagEnvironmentConfig, flagVersion } = await import(
      "../../db/schema/index.js"
    );

    await expect(db.select().from(flagEnvironmentConfig)).resolves.toHaveLength(
      2,
    );
    await expect(db.select().from(flagVersion)).resolves.toHaveLength(2);
  });

  it("keeps one environment's configuration out of another's", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");
    await seedEnvironment(projectId, "production", "Production");

    await createFlag(projectKey, session, {
      key: "checkout-v2",
      name: "Checkout v2",
      type: "boolean",
    });

    const published = await publishConfig(
      session,
      projectKey,
      "checkout-v2",
      "staging",
      { rolloutPercentage: 30 },
    );
    expect(published.status).toBe(200);

    await app.request(
      `${configPath(projectKey, "checkout-v2", "staging")}/rules`,
      {
        method: "PUT",
        headers: headers(session),
        body: JSON.stringify({
          rules: [
            {
              description: "Beta cohort",
              conditions: [
                {
                  attribute: "plan",
                  attributeType: "string",
                  operator: "equals",
                  values: ["beta"],
                },
              ],
              variation: "on",
              segmentKeys: [],
            },
          ],
        }),
      },
    );

    await app.request(
      `${configPath(projectKey, "checkout-v2", "staging")}/targets`,
      {
        method: "PUT",
        headers: headers(session),
        body: JSON.stringify({
          targets: [{ userId: "user-1", variationKey: "on" }],
        }),
      },
    );

    const stagingConfig = await readConfig(
      session,
      projectKey,
      "checkout-v2",
      "staging",
    );
    expect(stagingConfig).toMatchObject({
      enabled: true,
      rolloutPercentage: 30,
    });
    expect(stagingConfig.rules).toHaveLength(1);
    expect(stagingConfig.individualTargets).toEqual([
      { userId: "user-1", variationKey: "on" },
    ]);

    const productionConfig = await readConfig(
      session,
      projectKey,
      "checkout-v2",
      "production",
    );
    expect(productionConfig).toMatchObject({
      enabled: false,
      rolloutPercentage: 0,
      rules: [],
      individualTargets: [],
    });
  });

  it("archives project-wide and every environment evaluates the off variation", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");
    await seedEnvironment(projectId, "production", "Production");

    await createFlag(projectKey, session, {
      key: "checkout-v2",
      name: "Checkout v2",
      type: "boolean",
    });
    await publishConfig(session, projectKey, "checkout-v2", "staging");
    await publishConfig(session, projectKey, "checkout-v2", "production");

    const archived = await app.request(flagPath(projectKey, "checkout-v2"), {
      method: "DELETE",
      headers: { cookie: session.cookie },
    });

    expect(archived.status).toBe(200);
    await expect(archived.json()).resolves.toMatchObject({
      key: "checkout-v2",
      status: "archived",
    });

    // The status belongs to the flag, so it is archived in every environment.
    const detail = await app.request(flagPath(projectKey, "checkout-v2"), {
      headers: { cookie: session.cookie },
    });
    await expect(detail.json()).resolves.toMatchObject({ status: "archived" });

    for (const environmentKey of ["staging", "production"]) {
      const evaluated = await app.request("/v1/evaluate", {
        method: "POST",
        headers: headers(session),
        body: JSON.stringify({
          flag: "checkout-v2",
          environment: environmentKey,
          projectKey,
          user: { id: "user-1" },
        }),
      });

      expect(evaluated.status).toBe(200);
      await expect(evaluated.json()).resolves.toMatchObject({
        enabled: false,
        variation: "off",
        reason: "flag_archived",
      });
    }

    // The configurations survive the archive.
    const config = await readConfig(
      session,
      projectKey,
      "checkout-v2",
      "staging",
    );
    expect(config.enabled).toBe(true);
  });

  it("starts each environment's history at its own v1 and keeps identity edits out of it", async () => {
    const { session, organizationId, projectKey, projectId } =
      await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");
    await seedEnvironment(projectId, "production", "Production");

    await createFlag(projectKey, session, {
      key: "checkout-v2",
      name: "Checkout v2",
      type: "boolean",
    });
    await publishConfig(session, projectKey, "checkout-v2", "staging");

    expect(
      await versionNumbers(session, projectKey, "checkout-v2", "staging"),
    ).toEqual([2, 1]);
    expect(
      await versionNumbers(session, projectKey, "checkout-v2", "production"),
    ).toEqual([1]);

    const renamed = await app.request(flagPath(projectKey, "checkout-v2"), {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({ name: "Checkout v3" }),
    });
    expect(renamed.status).toBe(200);

    // An identity edit is not a configuration publish: no history row.
    expect(
      await versionNumbers(session, projectKey, "checkout-v2", "staging"),
    ).toEqual([2, 1]);
    expect(
      await versionNumbers(session, projectKey, "checkout-v2", "production"),
    ).toEqual([1]);

    // It is still audited, project-wide rather than against one environment.
    const { db } = await import("../../db/client.js");
    const { auditLog } = await import("../../db/schema/index.js");
    const audits = await db.select().from(auditLog);
    const identity = audits.filter((row) => row.action === "flag.updated");

    expect(identity).toHaveLength(1);
    expect(identity[0]?.environmentId).toBeNull();
    expect(audits.every((row) => row.organizationId === organizationId)).toBe(
      true,
    );
  });

  it("adds, edits and removes flag-level variations", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");
    await seedEnvironment(projectId, "production", "Production");

    await createFlag(projectKey, session, {
      key: "checkout-v2",
      name: "Checkout v2",
      type: "boolean",
    });

    const variationsUrl = `${flagPath(projectKey, "checkout-v2")}/variations`;

    const added = await app.request(variationsUrl, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        key: "maybe",
        name: "Maybe",
        value: true,
        description: "A third value",
      }),
    });

    expect(added.status).toBe(201);
    await expect(added.json()).resolves.toContainEqual(
      expect.objectContaining({ key: "maybe", name: "Maybe", value: true }),
    );

    const edited = await app.request(`${variationsUrl}/maybe`, {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({ name: "Maybe later", value: false }),
    });

    expect(edited.status).toBe(200);
    await expect(edited.json()).resolves.toContainEqual(
      expect.objectContaining({ key: "maybe", name: "Maybe later", value: false }),
    );

    // A flag's variations are shared: each environment selects among the same set.
    const detail = await app.request(flagPath(projectKey, "checkout-v2"), {
      headers: { cookie: session.cookie },
    });
    const body = (await detail.json()) as FlagDetail;
    expect(body.variations.map((variation) => variation.key).sort()).toEqual([
      "maybe",
      "off",
      "on",
    ]);
  });

  it("refuses to remove a variation an environment still references", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");
    await seedEnvironment(projectId, "production", "Production");

    await createFlag(projectKey, session, {
      key: "checkout-v2",
      name: "Checkout v2",
      type: "boolean",
    });

    const variationsUrl = `${flagPath(projectKey, "checkout-v2")}/variations`;
    await app.request(variationsUrl, {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({ key: "maybe", name: "Maybe", value: true }),
    });

    // A configuration's default selection blocks the removal and names where.
    await publishConfig(session, projectKey, "checkout-v2", "staging", {
      defaultVariation: "maybe",
    });

    const blockedByConfig = await app.request(`${variationsUrl}/maybe`, {
      method: "DELETE",
      headers: { cookie: session.cookie },
    });
    expect(blockedByConfig.status).toBe(409);
    const configError = (await blockedByConfig.json()) as {
      error: { message: string };
    };
    expect(configError.error.message).toContain("staging");

    // Re-pointing the selection frees the key.
    await publishConfig(session, projectKey, "checkout-v2", "staging", {
      defaultVariation: "on",
    });

    // A targeting rule blocks it too, naming its environment.
    await app.request(
      `${configPath(projectKey, "checkout-v2", "production")}/rules`,
      {
        method: "PUT",
        headers: headers(session),
        body: JSON.stringify({
          rules: [
            {
              description: "Maybe crew",
              conditions: [],
              variation: "maybe",
              segmentKeys: [],
            },
          ],
        }),
      },
    );

    const blockedByRule = await app.request(`${variationsUrl}/maybe`, {
      method: "DELETE",
      headers: { cookie: session.cookie },
    });
    expect(blockedByRule.status).toBe(409);
    const ruleError = (await blockedByRule.json()) as {
      error: { message: string };
    };
    expect(ruleError.error.message).toContain("production");

    await app.request(
      `${configPath(projectKey, "checkout-v2", "production")}/rules`,
      {
        method: "PUT",
        headers: headers(session),
        body: JSON.stringify({ rules: [] }),
      },
    );

    // So does an individual target.
    await app.request(
      `${configPath(projectKey, "checkout-v2", "production")}/targets`,
      {
        method: "PUT",
        headers: headers(session),
        body: JSON.stringify({
          targets: [{ userId: "user-9", variationKey: "maybe" }],
        }),
      },
    );

    const blockedByTarget = await app.request(`${variationsUrl}/maybe`, {
      method: "DELETE",
      headers: { cookie: session.cookie },
    });
    expect(blockedByTarget.status).toBe(409);
    const targetError = (await blockedByTarget.json()) as {
      error: { message: string };
    };
    expect(targetError.error.message).toContain("production");

    await app.request(
      `${configPath(projectKey, "checkout-v2", "production")}/targets`,
      {
        method: "PUT",
        headers: headers(session),
        body: JSON.stringify({ targets: [] }),
      },
    );

    const removed = await app.request(`${variationsUrl}/maybe`, {
      method: "DELETE",
      headers: { cookie: session.cookie },
    });
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.not.toContainEqual(
      expect.objectContaining({ key: "maybe" }),
    );
  });

  it("does not let a configuration patch change the flag's variations", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "staging", "Staging");

    await createFlag(projectKey, session, {
      key: "checkout-v2",
      name: "Checkout v2",
      type: "boolean",
    });

    const response = await app.request(
      configPath(projectKey, "checkout-v2", "staging"),
      {
        method: "PATCH",
        headers: headers(session),
        body: JSON.stringify({
          ...CONFIG,
          variations: [
            { key: "on", name: "Sneaky", value: "not-a-boolean", description: null },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.not.toHaveProperty("variations");

    const detail = await app.request(flagPath(projectKey, "checkout-v2"), {
      headers: { cookie: session.cookie },
    });
    const body = (await detail.json()) as FlagDetail;

    expect(body.variations.map((variation) => variation.name)).toEqual([
      "On",
      "Off",
    ]);
    expect(
      body.variations.find((variation) => variation.key === "on")?.value,
    ).toBe(true);
  });

  it("starts a string flag with the variation keys the caller names", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "development", "Development");
    await seedEnvironment(projectId, "staging", "Staging");

    const created = await createFlag(projectKey, session, {
      key: "checkout-experience",
      name: "Checkout experience",
      type: "string",
      variations: [
        { key: "variant-a", value: "new-checkout" },
        { key: "control", value: "old-checkout" },
      ],
      defaultVariation: "variant-a",
      offVariation: "control",
    });

    expect(created.status).toBe(201);
    const detail = (await created.json()) as FlagDetail;

    expect(detail.variations.map((variation) => variation.key)).toEqual([
      "variant-a",
      "control",
    ]);
    expect(detail.variations.map((variation) => variation.name)).toEqual([
      "Variant-a",
      "Control",
    ]);
    expect(
      detail.variations.find((variation) => variation.key === "control")?.value,
    ).toBe("old-checkout");

    // Every environment selects the named keys rather than the on/off pair.
    for (const environmentKey of ["development", "staging"]) {
      const config = await readConfig(
        session,
        projectKey,
        "checkout-experience",
        environmentKey,
      );

      expect(config).toMatchObject({
        environmentKey,
        enabled: false,
        defaultVariation: "variant-a",
        offVariation: "control",
      });
    }

    const disabled = await app.request("/v1/evaluate", {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        flag: "checkout-experience",
        environment: "development",
        projectKey,
        user: { id: "user-1" },
      }),
    });

    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      variation: "control",
      reason: "flag_disabled",
      enabled: false,
    });
  });

  it("creates a string flag with three values to experiment between", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "development", "Development");

    const created = await createFlag(projectKey, session, {
      key: "checkout-layout",
      name: "Checkout layout",
      type: "string",
      variations: [
        { key: "control", value: "classic" },
        { key: "compact", value: "compact" },
        { key: "one-page", value: "one-page" },
      ],
      defaultVariation: "compact",
      offVariation: "control",
    });

    expect(created.status).toBe(201);
    const detail = (await created.json()) as FlagDetail;

    expect(detail.variations.map((variation) => variation.key)).toEqual([
      "control",
      "compact",
      "one-page",
    ]);
    await expect(
      readConfig(session, projectKey, "checkout-layout", "development"),
    ).resolves.toMatchObject({
      defaultVariation: "compact",
      offVariation: "control",
    });
  });

  it("refuses a variation list when it does not say which two the environment selects", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "development", "Development");

    const response = await createFlag(projectKey, session, {
      key: "checkout-experience",
      name: "Checkout experience",
      type: "string",
      variations: [
        { key: "variant-a", value: "new-checkout" },
        { key: "control", value: "old-checkout" },
      ],
      offVariation: "control",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message:
          "variations, defaultVariation and offVariation have to be given together.",
      },
    });
  });

  it("refuses a selection that names no variation in the list", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "development", "Development");

    const response = await createFlag(projectKey, session, {
      key: "checkout-experience",
      name: "Checkout experience",
      type: "string",
      variations: [
        { key: "variant-a", value: "new-checkout" },
        { key: "control", value: "old-checkout" },
      ],
      defaultVariation: "variant-a",
      offVariation: "nope",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message:
          '"nope" is not one of the variations this flag is created with.',
      },
    });
  });

  it("refuses two variations sharing one key", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "development", "Development");

    const response = await createFlag(projectKey, session, {
      key: "checkout-experience",
      name: "Checkout experience",
      type: "string",
      variations: [
        { key: "control", value: "new-checkout" },
        { key: "control", value: "old-checkout" },
      ],
      defaultVariation: "control",
      offVariation: "control",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "Every variation needs a different key." },
    });
  });

  it("keeps a non-string flag to the conventional on and off pair", async () => {
    const { session, projectKey, projectId } = await ownerFixture();
    await seedEnvironment(projectId, "development", "Development");

    const response = await createFlag(projectKey, session, {
      key: "max-items",
      name: "Max items",
      type: "number",
      variations: [
        { key: "low", value: 1 },
        { key: "high", value: 5 },
      ],
      defaultVariation: "high",
      offVariation: "low",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: expect.stringContaining("variation list of its own") },
    });
  });
});
