import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type {
  WorkspaceProfile,
  WorkspaceSecuritySettings,
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

async function owner(): Promise<TestSession> {
  const session = await signUp(app);
  await seedWorkspace(session.userId, "owner");

  const project = await app.request("/v1/projects", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ name: "Checkout Platform" }),
  });
  expect(project.status).toBe(201);

  return session;
}

describe("workspace settings", () => {
  it("reads and updates the profile", async () => {
    const session = await owner();

    const initial = await app.request("/v1/workspace", {
      headers: { cookie: session.cookie },
    });

    expect(initial.status).toBe(200);
    const before = (await initial.json()) as WorkspaceProfile;

    expect(before).toMatchObject({
      name: "Test Workspace",
      timezone: "UTC",
      defaultEnvironmentId: null,
    });

    const updated = await app.request("/v1/workspace", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({
        name: "Acme Inc",
        timezone: "Europe/London",
        defaultEnvironmentKey: "development",
      }),
    });

    expect(updated.status).toBe(200);
    const profile = (await updated.json()) as WorkspaceProfile;

    expect(profile.name).toBe("Acme Inc");
    expect(profile.timezone).toBe("Europe/London");
    expect(profile.defaultEnvironmentId).not.toBeNull();
    // The slug is immutable: it is already in URLs the user has shared.
    expect(profile.slug).toBe(before.slug);

    const reread = await app.request("/v1/workspace", {
      headers: { cookie: session.cookie },
    });
    await expect(reread.json()).resolves.toMatchObject({
      name: "Acme Inc",
      timezone: "Europe/London",
    });
  });

  it("rejects an unknown default environment", async () => {
    const session = await owner();

    const response = await app.request("/v1/workspace", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({ defaultEnvironmentKey: "nope" }),
    });

    expect(response.status).toBe(400);
  });

  it("stores security settings over their defaults", async () => {
    const session = await owner();

    const initial = await app.request("/v1/workspace/security", {
      headers: { cookie: session.cookie },
    });
    await expect(initial.json()).resolves.toMatchObject({
      ssoConnected: false,
      sessionTimeout: "24h",
      auditRetentionDays: 90,
      allowedEmailDomains: [],
    });

    const updated = await app.request("/v1/workspace/security", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({
        ssoProvider: null,
        ssoConnected: false,
        twoFactorEnabled: true,
        sessionTimeout: "12h",
        allowedEmailDomains: ["iwifunni.dev"],
        ipAllowlistConfigured: false,
        auditRetentionDays: 365,
      }),
    });

    expect(updated.status).toBe(200);
    const settings = (await updated.json()) as WorkspaceSecuritySettings;
    expect(settings).toMatchObject({
      twoFactorEnabled: true,
      sessionTimeout: "12h",
      auditRetentionDays: 365,
      allowedEmailDomains: ["iwifunni.dev"],
    });

    // The profile write must not wipe the security block stored beside it.
    await app.request("/v1/workspace", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({ timezone: "UTC" }),
    });

    const reread = await app.request("/v1/workspace/security", {
      headers: { cookie: session.cookie },
    });
    await expect(reread.json()).resolves.toMatchObject({
      sessionTimeout: "12h",
      auditRetentionDays: 365,
    });
  });

  it("lets a plain member read but not change settings", async () => {
    await owner();

    const member = await signUp(app);
    const workspace = await seedWorkspace(member.userId, "member");

    const read = await app.request("/v1/workspace", {
      headers: { cookie: member.cookie },
    });
    expect(read.status).toBe(200);

    const write = await app.request("/v1/workspace", {
      method: "PATCH",
      headers: headers(member),
      body: JSON.stringify({ name: "Hijacked" }),
    });
    expect(write.status).toBe(403);

    const security = await app.request("/v1/workspace/security", {
      method: "PATCH",
      headers: headers(member),
      body: JSON.stringify({
        ssoProvider: null,
        ssoConnected: false,
        twoFactorEnabled: false,
        sessionTimeout: "1h",
        allowedEmailDomains: [],
        ipAllowlistConfigured: false,
        auditRetentionDays: 30,
      }),
    });
    expect(security.status).toBe(403);
    expect(workspace.organizationId).toBeTruthy();
  });

  it("needs a session", async () => {
    const response = await app.request("/v1/workspace");

    expect(response.status).toBe(401);
  });
});
