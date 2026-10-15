import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { EvaluationResult } from "@iwifunni/contracts";

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

async function createProject(
  session: TestSession,
  name: string,
): Promise<{ key: string }> {
  const response = await app.request("/v1/projects", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ name }),
  });

  expect(response.status).toBe(201);

  return (await response.json()) as { key: string };
}

async function createFlag(
  session: TestSession,
  projectKey: string,
  key: string,
): Promise<void> {
  const response = await app.request(`/v1/projects/${projectKey}/flags`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ key, name: key, type: "boolean" }),
  });

  expect(response.status).toBe(201);
}

async function publishConfig(
  session: TestSession,
  projectKey: string,
  flagKey: string,
  enabled: boolean,
  rolloutPercentage = 100,
): Promise<void> {
  const response = await app.request(
    `/v1/projects/${projectKey}/flags/${flagKey}/environments/development`,
    {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({
        enabled,
        offVariation: "off",
        defaultVariation: "on",
        // Defaults to 100: the endpoint serves everybody, while 0 now serves
        // nobody, so these cases would otherwise only ever see the off variation.
        rolloutPercentage,
        bucketBy: "userId",
      }),
    },
  );

  expect(response.status).toBe(200);
}

async function evaluate(
  session: TestSession,
  body: Record<string, unknown>,
): Promise<{ status: number; result: EvaluationResult }> {
  const response = await app.request("/v1/evaluate", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({
      flag: "checkout-v2",
      environment: "development",
      user: { id: "user-1" },
      ...body,
    }),
  });

  return {
    status: response.status,
    result: (await response.json()) as EvaluationResult,
  };
}

describe("POST /v1/evaluate", () => {
  it("returns the configured decision and writes nothing", async () => {
    const session = await signUp(app);
    await seedWorkspace(session.userId, "owner");
    const project = await createProject(session, "Checkout Platform");

    await createFlag(session, project.key, "checkout-v2");
    await publishConfig(session, project.key, "checkout-v2", true);

    const { db } = await import("../../db/client.js");
    const { auditLog } = await import("../../db/schema/index.js");
    const before = (await db.select().from(auditLog)).length;

    const { status, result } = await evaluate(session, {});

    expect(status).toBe(200);
    expect(result).toMatchObject({
      flag: "checkout-v2",
      enabled: true,
      variation: "on",
      reason: "default_variation",
      matchedRuleId: null,
    });

    expect((await db.select().from(auditLog)).length).toBe(before);
  });

  it("serves the off variation for a disabled flag and reports a missing one", async () => {
    const session = await signUp(app);
    await seedWorkspace(session.userId, "owner");
    const project = await createProject(session, "Checkout Platform");

    await createFlag(session, project.key, "checkout-v2");

    const disabled = await evaluate(session, {});
    expect(disabled.result).toMatchObject({
      enabled: false,
      variation: "off",
      reason: "flag_disabled",
    });

    const missing = await evaluate(session, { flag: "nope" });
    expect(missing.result).toMatchObject({
      enabled: false,
      variation: "off",
      reason: "flag_not_found",
    });
  });

  it("serves nobody for a flag that is enabled at 0% rollout", async () => {
    const session = await signUp(app);
    await seedWorkspace(session.userId, "owner");
    const project = await createProject(session, "Checkout Platform");

    await createFlag(session, project.key, "checkout-v2");
    await publishConfig(session, project.key, "checkout-v2", true, 0);

    // 0% is a threshold, not a skipped branch: it is the off variation for
    // everybody, and `enabled` follows the variation that was served.
    for (const id of ["user-1", "user-2", "user-3"]) {
      const { result } = await evaluate(session, { user: { id } });

      expect(result).toMatchObject({
        enabled: false,
        variation: "off",
        reason: "percentage_rollout",
      });
    }
  });

  it("uses projectKey to disambiguate two projects with the same keys", async () => {
    const session = await signUp(app);
    await seedWorkspace(session.userId, "owner");

    const alpha = await createProject(session, "Alpha Platform");
    const beta = await createProject(session, "Beta Platform");

    for (const project of [alpha, beta]) {
      await createFlag(session, project.key, "checkout-v2");
    }

    await publishConfig(session, alpha.key, "checkout-v2", true);
    await publishConfig(session, beta.key, "checkout-v2", false);

    // Without a project key the lowest project key wins.
    const ambiguous = await evaluate(session, {});
    expect(ambiguous.result).toMatchObject({ reason: "default_variation" });

    const targeted = await evaluate(session, { projectKey: beta.key });
    expect(targeted.result).toMatchObject({
      reason: "flag_disabled",
      enabled: false,
    });
  });

  it("answers another workspace's flag with flag_not_found", async () => {
    const owner = await signUp(app);
    await seedWorkspace(owner.userId, "owner");
    const project = await createProject(owner, "Checkout Platform");
    await createFlag(owner, project.key, "checkout-v2");
    await publishConfig(owner, project.key, "checkout-v2", true);

    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");

    const { result } = await evaluate(outsider, {});

    expect(result).toMatchObject({ reason: "flag_not_found" });
  });

  it("requires a session", async () => {
    const response = await app.request("/v1/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        flag: "checkout-v2",
        environment: "development",
        user: { id: "user-1" },
      }),
    });

    expect(response.status).toBe(401);
  });

  it("rejects a request without a user id", async () => {
    const session = await signUp(app);
    await seedWorkspace(session.userId, "owner");

    const response = await app.request("/v1/evaluate", {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        flag: "checkout-v2",
        environment: "development",
        user: {},
      }),
    });

    expect(response.status).toBe(400);
  });
});
