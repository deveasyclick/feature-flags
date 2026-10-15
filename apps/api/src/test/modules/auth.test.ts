import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { MeResponse } from "@iwifunni/contracts";

import {
  closeTestDatabase,
  loadApp,
  loadTestEnv,
  registerUser,
  resetTestDatabase,
  seedWorkspace,
  signUp,
  truncateAll,
  verificationCode,
  TEST_PASSWORD,
  type TestSession,
} from "../harness.js";

/**
 * Integration coverage for the auth module: the Better Auth endpoints mounted at
 * `/api/auth/*`, the provider list and the session gate behind `GET /v1/me`.
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

function jsonHeaders(session?: TestSession): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(session ? { cookie: session.cookie } : {}),
  };
}

/** The session cookie a Better Auth response sets, without its attributes. */
function readFirstCookie(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function me(session?: TestSession): Promise<MeResponse> {
  const response = await app.request("/v1/me", {
    headers: session ? { cookie: session.cookie } : {},
  });

  expect(response.status).toBe(200);

  return (await response.json()) as MeResponse;
}

describe("auth module", () => {
  it("lists the configured social providers", async () => {
    const session = await signUp(app);

    const response = await app.request("/v1/auth/providers");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { enabled: string[] };

    expect(Array.isArray(body.enabled)).toBe(true);
    // The same list the dashboard reads from /v1/me, so the two cannot drift.
    expect((await me(session)).providers.enabled).toEqual(body.enabled);
  });

  it("reports onboarding state through /v1/me as it progresses", async () => {
    const session = await signUp(app);

    const fresh = await me(session);
    expect(fresh).toMatchObject({
      user: { id: session.userId, email: session.email, emailVerified: true },
      workspace: null,
      hasProject: false,
    });

    const workspace = await seedWorkspace(session.userId, "owner");

    const withWorkspace = await me(session);
    expect(withWorkspace.workspace).toMatchObject({
      id: workspace.organizationId,
      role: "owner",
    });
    expect(withWorkspace.hasProject).toBe(false);

    const created = await app.request("/v1/projects", {
      method: "POST",
      headers: jsonHeaders(session),
      body: JSON.stringify({ name: "Checkout Platform" }),
    });
    expect(created.status).toBe(201);

    expect((await me(session)).hasProject).toBe(true);
  });

  it("refuses /v1/me without a session", async () => {
    const response = await app.request("/v1/me");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized" },
    });
  });

  it("signs in with the right password only", async () => {
    const session = await signUp(app);

    const wrong = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ email: session.email, password: "not-the-password" }),
    });
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const right = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ email: session.email, password: TEST_PASSWORD }),
    });
    expect(right.status).toBe(200);

    const cookie = (right.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(cookie).not.toBe("");

    const authenticated = await app.request("/v1/me", {
      headers: { cookie },
    });
    expect(authenticated.status).toBe(200);
  });

  it("withholds a session until the emailed code is entered", async () => {
    const attempt = await registerUser(app, "Unconfirmed User");

    const refused = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        email: attempt.email,
        password: TEST_PASSWORD,
      }),
    });

    // Its own code and status, so the dashboard can ask for the code instead of
    // claiming the password was wrong.
    expect(refused.status).toBe(403);
    await expect(refused.json()).resolves.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
    });

    const wrong = await app.request("/api/auth/email-otp/verify-email", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ email: attempt.email, otp: "000000" }),
    });

    // A guessed code confirms nothing and hands out no session.
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(wrong.headers.get("set-cookie")).toBeNull();

    const code = await verificationCode(attempt.email);
    const confirmed = await app.request("/api/auth/email-otp/verify-email", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ email: attempt.email, otp: code }),
    });

    expect(confirmed.status).toBe(200);
    await expect(confirmed.json()).resolves.toMatchObject({
      status: true,
      user: { email: attempt.email, emailVerified: true },
    });

    // Confirming signs the caller in, so the dashboard never has to bounce the
    // user through a link and back.
    const cookie = readFirstCookie(confirmed);
    expect(cookie).not.toBe("");

    const authenticated = await app.request("/v1/me", { headers: { cookie } });
    expect(authenticated.status).toBe(200);

    // And the password works from now on.
    const signedIn = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        email: attempt.email,
        password: TEST_PASSWORD,
      }),
    });
    expect(signedIn.status).toBe(200);
  });

  it("refuses a code once it has been spent", async () => {
    const { email } = await registerUser(app);
    const code = await verificationCode(email);

    const first = await app.request("/api/auth/email-otp/verify-email", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ email, otp: code }),
    });
    expect(first.status).toBe(200);

    const replay = await app.request("/api/auth/email-otp/verify-email", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ email, otp: code }),
    });
    expect(replay.status).toBeGreaterThanOrEqual(400);
  });

  it("answers a code request the same way for known and unknown addresses", async () => {
    const session = await signUp(app);

    const send = (email: string) =>
      app.request("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ email, type: "email-verification" }),
      });

    const known = await send(session.email);
    const unknown = await send("nobody@example.com");

    // Nothing revealed: an address with an account takes the same path as one
    // without, so this cannot be used to discover who has signed up.
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    await expect(known.json()).resolves.toMatchObject({ success: true });
    await expect(unknown.json()).resolves.toMatchObject({ success: true });
  });

  it("signs out and stops honouring the old session", async () => {
    const session = await signUp(app);
    expect((await me(session)).user.id).toBe(session.userId);

    const signedOut = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: jsonHeaders(session),
    });
    expect(signedOut.status).toBe(200);

    const after = await app.request("/v1/me", {
      headers: { cookie: session.cookie },
    });
    expect(after.status).toBe(401);
  });

  it("answers a code request the same way for known and unknown addresses", async () => {
    const session = await signUp(app);

    const request = (email: string) =>
      app.request("/api/auth/email-otp/request-password-reset", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ email }),
      });

    const known = await request(session.email);
    const unknown = await request("nobody@example.com");

    // Identical answers, or the endpoint would confirm which accounts exist.
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    await expect(known.json()).resolves.toMatchObject({ success: true });
    await expect(unknown.json()).resolves.toMatchObject({ success: true });
  });

  it("resets the password with an emailed code and no link", async () => {
    const session = await signUp(app);
    const replacement = "replacement-password-1";

    const requested = await app.request(
      "/api/auth/email-otp/request-password-reset",
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ email: session.email }),
      },
    );
    expect(requested.status).toBe(200);

    const reset = (otp: string) =>
      app.request("/api/auth/email-otp/reset-password", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          email: session.email,
          otp,
          password: replacement,
        }),
      });

    const guessed = await reset("000000");
    expect(guessed.status).toBeGreaterThanOrEqual(400);

    const accepted = await reset(
      await verificationCode(session.email, "forget-password"),
    );
    expect(accepted.status).toBe(200);

    const signIn = (password: string) =>
      app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ email: session.email, password }),
      });

    expect((await signIn(TEST_PASSWORD)).status).toBeGreaterThanOrEqual(400);
    expect((await signIn(replacement)).status).toBe(200);
  });

  it("hashes the password with a per-account salt rather than storing it", async () => {
    const session = await signUp(app);
    const twin = await signUp(app);
    const { db } = await import("../../db/client.js");
    const { account } = await import("../../db/schema/index.js");
    const rows = await db.select().from(account);

    const stored = (userId: string) =>
      rows.find((row) => row.userId === userId)?.password ?? "";

    const first = stored(session.userId);
    const second = stored(twin.userId);

    expect(first).not.toBe(TEST_PASSWORD);
    expect(first).not.toContain(TEST_PASSWORD);
    // scrypt writes `<salt>:<key>`; the shape is what makes it a password hash
    // rather than an encoded password.
    expect(first).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    // Two accounts that chose the same password must not share a digest, or the
    // table would tell an attacker which users picked the same one.
    expect(first).not.toBe(second);
  });
});
