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
