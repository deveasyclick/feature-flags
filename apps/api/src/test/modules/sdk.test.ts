import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { CreatedApiKey, SdkConfig } from "@iwifunni/contracts";

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

async function fixture(name = "Checkout Platform"): Promise<Fixture> {
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

async function createFlag(
  underTest: Fixture,
  key = "checkout-v2",
): Promise<void> {
  const response = await app.request(
    `/v1/projects/${underTest.projectKey}/flags`,
    {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({ key, name: key, type: "boolean" }),
    },
  );

  expect(response.status).toBe(201);
}

async function issueSdkKey(
  underTest: Fixture,
  body: Record<string, unknown> = {},
): Promise<CreatedApiKey> {
  const response = await app.request(
    `/v1/projects/${underTest.projectKey}/api-keys`,
    {
      method: "POST",
      headers: headers(underTest.session),
      body: JSON.stringify({
        name: "SDK key",
        kind: "server",
        environmentKey: "development",
        scopes: ["flags:read"],
        ...body,
      }),
    },
  );

  expect(response.status).toBe(201);

  return (await response.json()) as CreatedApiKey;
}

async function config(
  secret: string,
  init: RequestInit = {},
): Promise<Response> {
  return app.request("/v1/sdk/config", {
    ...init,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(init.headers ?? {}),
    },
  });
}

describe("sdk config", () => {
  it("streams only version notifications, bounds connections, and releases slots on disconnect", async () => {
    const test = await fixture();
    const key = await issueSdkKey(test);
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    try {
      for (let index = 0; index < 3; index++) {
        const response = await app.request("/v1/sdk/stream", {
          headers: { authorization: `Bearer ${key.secret}` },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/event-stream");
        expect(response.headers.get("x-accel-buffering")).toBe("no");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("The stream has no body.");
        readers.push(reader);
        const chunk = await reader.read();
        const text = new TextDecoder().decode(chunk.value);
        expect(text).toContain("event: configuration");
        const data = text
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6);
        expect(Object.keys(JSON.parse(data ?? "{}"))).toEqual(["version"]);
      }
      const limited = await app.request("/v1/sdk/stream", {
        headers: { authorization: `Bearer ${key.secret}` },
      });
      expect(limited.status).toBe(429);
      await readers.pop()?.cancel();
      const reopened = await app.request("/v1/sdk/stream", {
        headers: { authorization: `Bearer ${key.secret}` },
      });
      expect(reopened.status).toBe(200);
      await reopened.body?.cancel();
      const client = await issueSdkKey(test, { kind: "client" });
      const refused = await app.request("/v1/sdk/stream", {
        headers: { authorization: `Bearer ${client.secret}` },
      });
      expect(refused.status).toBe(403);
    } finally {
      await Promise.all(readers.map((reader) => reader.cancel()));
    }
  });

  it("deduplicates analytics, stores no raw subject, and restricts totals to the workspace", async () => {
    const test = await fixture();
    const key = await issueSdkKey(test, {
      scopes: ["flags:read", "events:write"],
    });
    const { randomUUID } = await import("node:crypto");
    const event = {
      id: randomUUID(),
      flagKey: "checkout-v2",
      variation: "on",
      reason: "default_variation",
      userId: "private-subject@example.com",
      latencyMs: 2.5,
    };
    const send = (secret: string) =>
      app.request("/v1/sdk/events", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ events: [event] }),
      });
    const first = await send(key.secret);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ accepted: 1 });
    expect(await (await send(key.secret)).json()).toEqual({ accepted: 0 });
    const readOnly = await issueSdkKey(test);
    expect((await send(readOnly.secret)).status).toBe(403);
    const summary = await app.request("/v1/analytics", {
      headers: headers(test.session),
    });
    expect(summary.status).toBe(200);
    await expect(summary.json()).resolves.toMatchObject({
      evaluations: 1,
      users: 1,
      avgLatencyMs: 2.5,
      p95LatencyMs: 2.5,
      topFlags: [{ flagKey: "checkout-v2" }],
      environments: [{ environmentKey: "development", evaluations: 1 }],
    });
    const outsider = await signUp(app);
    await seedWorkspace(outsider.userId, "owner");
    const hidden = await app.request("/v1/analytics", {
      headers: headers(outsider),
    });
    await expect(hidden.json()).resolves.toMatchObject({
      evaluations: 0,
      users: 0,
      topFlags: [],
    });
    const forbiddenProject = await app.request(
      `/v1/analytics?projectKey=${test.projectKey}`,
      { headers: headers(outsider) },
    );
    expect(forbiddenProject.status).toBe(404);
    const { db } = await import("../../db/client.js");
    const { evaluationEvent } = await import("../../db/schema/index.js");
    const rows = await db.select().from(evaluationEvent);
    expect(rows[0]?.subjectHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(event.userId);
    await db
      .update(evaluationEvent)
      .set({ createdAt: new Date(Date.now() - 91 * 86_400_000) });
    const { retainEvaluationEvents } = await import("../../app.js");
    await retainEvaluationEvents();
    expect(await db.select().from(evaluationEvent)).toEqual([]);
  });

  it("delivers only opted-in evaluated values to client keys and keeps targeting private", async () => {
    const test = await fixture();
    await createFlag(test, "browser-banner");
    await createFlag(test, "private-control");
    const key = await issueSdkKey(test, { kind: "client" });
    const path = `/v1/projects/${test.projectKey}/flags/browser-banner/client-visibility`;
    const set = await app.request(path, {
      method: "PATCH",
      headers: headers(test.session),
      body: JSON.stringify({ clientVisible: true }),
    });
    expect(set.status).toBe(200);
    const response = await app.request("/v1/sdk/evaluate", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        user: { id: "browser-user", email: "person@example.com" },
        flags: ["browser-banner", "private-control", "does-not-exist"],
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const preflight = await app.request("/v1/sdk/evaluate", {
      method: "OPTIONS",
      headers: {
        origin: "https://customer.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(
      preflight.headers.get("access-control-allow-credentials"),
    ).toBeNull();
    expect(await response.json()).toEqual({
      flags: { "browser-banner": { value: false, enabled: false } },
    });
    expect((await config(key.secret)).status).toBe(403);
    const targeting = await app.request(
      `/v1/projects/${test.projectKey}/flags/browser-banner/environments/development/rules`,
      {
        method: "PUT",
        headers: headers(test.session),
        body: JSON.stringify({
          rules: [
            {
              conditions: [
                {
                  attribute: "name",
                  attributeType: "string",
                  operator: "matches_regex",
                  values: ["(a+)+$"],
                },
              ],
              variation: "on",
              segmentKeys: [],
            },
          ],
        }),
      },
    );
    expect(targeting.status).toBe(200);
    const regex = await app.request("/v1/sdk/evaluate", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        user: { id: "browser-user", name: "a".repeat(50) + "!" },
        flags: ["browser-banner"],
      }),
    });
    expect(regex.status).toBe(400);
    await app.request(path, {
      method: "PATCH",
      headers: headers(test.session),
      body: JSON.stringify({ clientVisible: false }),
    });
    const revoked = await app.request("/v1/sdk/evaluate", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        user: { id: "browser-user" },
        flags: ["browser-banner"],
      }),
    });
    expect(await revoked.json()).toEqual({ flags: {} });
  });

  it("keeps snapshot reads on one committed database version", async () => {
    const underTest = await fixture();
    const key = await issueSdkKey(underTest);
    if (!key.environmentId)
      throw new Error("The fixture must issue an environment key.");
    const environmentId = key.environmentId;
    const { SdkRepository } = await import(
      "../../modules/sdk/sdk.repository.js"
    );
    const { db } = await import("../../db/client.js");
    const { project } = await import("../../db/schema/index.js");
    const { eq } = await import("drizzle-orm");
    const repository = new SdkRepository();
    await repository.withSnapshot(async (tx) => {
      const before = await repository.findMeta(
        underTest.projectId,
        environmentId,
        tx,
      );
      await db
        .update(project)
        .set({ name: "A concurrent rename" })
        .where(eq(project.id, underTest.projectId));
      const after = await repository.findMeta(
        underTest.projectId,
        environmentId,
        tx,
      );
      expect(after?.projectName).toBe(before?.projectName);
      expect(after?.projectName).not.toBe("A concurrent rename");
    });
    const response = await config(key.secret);
    await expect(response.json()).resolves.toMatchObject({
      project: { name: "A concurrent rename" },
    });
  });

  it("never exposes configuration snapshots to browser keys", async () => {
    const underTest = await fixture();
    await createFlag(underTest);
    const key = await issueSdkKey(underTest, { kind: "client" });
    const response = await config(key.secret);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });

  it("serves one environment's configuration to a runtime key", async () => {
    const underTest = await fixture();
    await createFlag(underTest);
    const key = await issueSdkKey(underTest);

    const response = await config(key.secret);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as SdkConfig;

    expect(body.project.key).toBe(underTest.projectKey);
    expect(body.environment.key).toBe("development");
    expect(body.version).toMatch(/^[0-9a-f]{32}$/);
    expect(body.flags).toHaveLength(1);
    expect(body.flags[0]).toMatchObject({
      key: "checkout-v2",
      type: "boolean",
      status: "active",
      enabled: false,
      offVariation: "off",
      defaultVariation: "on",
    });
    expect(body.flags[0]?.variations.map((entry) => entry.key).sort()).toEqual([
      "off",
      "on",
    ]);
    expect(body.segments).toEqual([]);
    expect(response.headers.get("etag")).toBe(`"${body.version}"`);
  });

  it("answers 304 while the configuration is unchanged", async () => {
    const underTest = await fixture();
    await createFlag(underTest);
    const key = await issueSdkKey(underTest);

    const first = await config(key.secret);
    const etag = first.headers.get("etag") ?? "";

    const unchanged = await config(key.secret, {
      headers: { "if-none-match": etag },
    });

    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
  });

  it("changes the version when the environment's configuration changes", async () => {
    const underTest = await fixture();
    await createFlag(underTest);
    const key = await issueSdkKey(underTest);

    const before = (await (await config(key.secret)).json()) as SdkConfig;

    const published = await app.request(
      `/v1/projects/${underTest.projectKey}/flags/checkout-v2/environments/development`,
      {
        method: "PATCH",
        headers: headers(underTest.session),
        body: JSON.stringify({
          enabled: true,
          offVariation: "off",
          defaultVariation: "on",
          rolloutPercentage: 0,
          bucketBy: "userId",
        }),
      },
    );
    expect(published.status).toBe(200);

    const after = (await (await config(key.secret)).json()) as SdkConfig;

    expect(after.version).not.toBe(before.version);
    expect(after.flags[0]?.enabled).toBe(true);
  });

  it("answers 401 without a key, and for an unknown or revoked one", async () => {
    const underTest = await fixture();
    const key = await issueSdkKey(underTest);

    expect((await app.request("/v1/sdk/config")).status).toBe(401);
    expect((await config("ff_deadbeef_nope")).status).toBe(401);
    expect((await config("not-a-key")).status).toBe(401);

    const revoked = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys/${key.id}`,
      { method: "DELETE", headers: { cookie: underTest.session.cookie } },
    );
    expect(revoked.status).toBe(200);
    expect((await config(key.secret)).status).toBe(401);
  });

  it("refuses a management key", async () => {
    const underTest = await fixture();

    const response = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({
          name: "Management",
          environmentKey: "development",
          scopes: ["flags:read"],
        }),
      },
    );
    const key = (await response.json()) as CreatedApiKey;

    expect(key.kind).toBe("management");

    const refused = await config(key.secret);

    expect(refused.status).toBe(403);
    await expect(refused.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });

  it("refuses to issue a runtime key without an environment or with a write scope", async () => {
    const underTest = await fixture();

    const noEnvironment = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({
          name: "SDK key",
          kind: "server",
          environmentKey: null,
          scopes: ["flags:read"],
        }),
      },
    );
    expect(noEnvironment.status).toBe(400);

    const writeScope = await app.request(
      `/v1/projects/${underTest.projectKey}/api-keys`,
      {
        method: "POST",
        headers: headers(underTest.session),
        body: JSON.stringify({
          name: "SDK key",
          kind: "client",
          environmentKey: "development",
          scopes: ["flags:read", "flags:write"],
        }),
      },
    );
    expect(writeScope.status).toBe(400);
  });

  it("stamps the key as used", async () => {
    const underTest = await fixture();
    const key = await issueSdkKey(underTest);

    expect((await config(key.secret)).status).toBe(200);

    const { db } = await import("../../db/client.js");
    const { apiKey } = await import("../../db/schema/index.js");
    const [row] = await db.select().from(apiKey);

    expect(row?.lastUsedAt).not.toBeNull();
  });

  it("does not resolve a key presented off the SDK surface", async () => {
    const underTest = await fixture();
    const key = await issueSdkKey(underTest);

    const management = await app.request(
      `/v1/projects/${underTest.projectKey}/flags`,
      { headers: { authorization: `Bearer ${key.secret}` } },
    );

    expect(management.status).toBe(401);

    const { db } = await import("../../db/client.js");
    const { apiKey } = await import("../../db/schema/index.js");
    const [row] = await db.select().from(apiKey);

    expect(row?.lastUsedAt).toBeNull();
  });

  it("reads only its own tenant's project", async () => {
    const first = await fixture("First");
    await createFlag(first, "first-flag");

    const second = await fixture("Second");
    await createFlag(second, "second-flag");

    const key = await issueSdkKey(second);
    const body = (await (await config(key.secret)).json()) as SdkConfig;

    expect(body.project.key).toBe(second.projectKey);
    expect(body.flags.map((flag) => flag.key)).toEqual(["second-flag"]);
  });
});
