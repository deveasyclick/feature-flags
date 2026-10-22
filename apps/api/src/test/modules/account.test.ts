import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { MeResponse, UserPreferences } from "@iwifunni/contracts";

import {
  closeTestDatabase,
  loadApp,
  loadTestEnv,
  resetTestDatabase,
  seedWorkspace,
  signUp,
  truncateAll,
  TEST_PASSWORD,
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

/** A signed-in user with a workspace and its onboarding environment. */
async function fixture(): Promise<TestSession> {
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

describe("account module", () => {
  it("reads persisted preferences only for the current user", async () => {
    const session = await fixture();
    expect((await app.request("/v1/me/preferences")).status).toBe(401);
    const initial = await app.request("/v1/me/preferences", {
      headers: headers(session),
    });
    await expect(initial.json()).resolves.toMatchObject({
      theme: "system",
      notifications: { flagChanges: true },
    });
    await app.request("/v1/me/preferences", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({
        theme: "dark",
        defaultEnvironmentKey: "production",
      }),
    });
    await app.request("/v1/me/notifications", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({
        flagChanges: false,
        weeklyDigest: false,
        incidentAlerts: false,
      }),
    });
    const saved = await app.request("/v1/me/preferences", {
      headers: headers(session),
    });
    const value = (await saved.json()) as UserPreferences;
    expect(value.theme).toBe("dark");
    expect(value.defaultEnvironmentId).not.toBeNull();
    expect(value.notifications.flagChanges).toBe(false);
    const other = await signUp(app);
    const isolated = await app.request("/v1/me/preferences", {
      headers: headers(other),
    });
    await expect(isolated.json()).resolves.toMatchObject({
      theme: "system",
      defaultEnvironmentId: null,
      notifications: { flagChanges: true },
    });
  });
  it("updates the display name and refuses a different sign-in email", async () => {
    const session = await fixture();

    const renamed = await app.request("/v1/me", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({ name: "Ada Lovelace", email: session.email }),
    });

    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({
      name: "Ada Lovelace",
      email: session.email,
      emailVerified: true,
    });

    const me = await app.request("/v1/me", {
      headers: { cookie: session.cookie },
    });
    await expect(me.json()).resolves.toMatchObject({
      user: { name: "Ada Lovelace" },
    });

    const changed = await app.request("/v1/me", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({ name: "Ada", email: "other@example.com" }),
    });

    // Never silently accepted: a new address needs a verification step.
    expect(changed.status).toBe(400);
  });

  it("changes the password only when the current one is right", async () => {
    const session = await fixture();

    const wrong = await app.request("/v1/me/password", {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        currentPassword: "definitely-not-it",
        newPassword: "brand-new-password-1",
      }),
    });
    expect(wrong.status).toBe(400);

    const changed = await app.request("/v1/me/password", {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        currentPassword: TEST_PASSWORD,
        newPassword: "brand-new-password-1",
      }),
    });
    expect(changed.status).toBe(200);

    const oldPassword = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: session.email, password: TEST_PASSWORD }),
    });
    expect(oldPassword.status).toBeGreaterThanOrEqual(400);

    const newPassword = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: session.email,
        password: "brand-new-password-1",
      }),
    });
    expect(newPassword.status).toBe(200);
  });

  it("stores preferences and notifications, resolving the environment key", async () => {
    const session = await fixture();

    const preferences = await app.request("/v1/me/preferences", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({
        theme: "dark",
        defaultEnvironmentKey: "development",
      }),
    });

    expect(preferences.status).toBe(200);
    const stored = (await preferences.json()) as UserPreferences;

    expect(stored.theme).toBe("dark");
    expect(stored.defaultEnvironmentId).not.toBeNull();

    const notifications = await app.request("/v1/me/notifications", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({
        flagChanges: false,
        weeklyDigest: true,
        incidentAlerts: false,
      }),
    });

    await expect(notifications.json()).resolves.toMatchObject({
      theme: "dark",
      notifications: {
        flagChanges: false,
        weeklyDigest: true,
        incidentAlerts: false,
      },
    });

    const cleared = await app.request("/v1/me/preferences", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({ theme: "system", defaultEnvironmentKey: null }),
    });
    await expect(cleared.json()).resolves.toMatchObject({
      defaultEnvironmentId: null,
      notifications: { weeklyDigest: true },
    });

    const unknown = await app.request("/v1/me/preferences", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({ theme: "dark", defaultEnvironmentKey: "nope" }),
    });
    expect(unknown.status).toBe(400);
  });

  it("needs a session for every write", async () => {
    const response = await app.request("/v1/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nobody", email: "nobody@example.com" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized" },
    });
  });

  it("reports the renamed user on /v1/me", async () => {
    const session = await fixture();

    await app.request("/v1/me", {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify({ name: "Grace Hopper", email: session.email }),
    });

    const me = await app.request("/v1/me", {
      headers: { cookie: session.cookie },
    });
    const body = (await me.json()) as MeResponse;

    expect(body.user.name).toBe("Grace Hopper");
    expect(body.workspace).not.toBeNull();
  });
});
