import { randomUUID } from "node:crypto";

import { Client } from "pg";

/**
 * Route/integration harness.
 *
 * Every helper here assumes `loadTestEnv()` ran before the first import of
 * `src/config/index.ts`, which validates its environment at module load. Use
 * the dynamic-import pattern in `harness.test.ts` rather than static imports of
 * `../app.js` or `../db/client.js`.
 *
 * Isolation is by truncation rather than a rolled-back transaction: the app's
 * `db` is a module-level pool and services open their own transactions, so a
 * single wrapping transaction cannot be injected without restructuring the
 * composition root. `vitest.config.ts` runs files sequentially because they
 * share one test database.
 */

const DEFAULT_TEST_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5442/dariise_test";

const ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5442/postgres";

export const TEST_PASSWORD = "test-password-123";

export interface TestSession {
  cookie: string;
  userId: string;
  email: string;
}

/** Any Hono app: avoids threading the router's Variables type through tests. */
export interface TestApp {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

export function loadTestEnv(): void {
  process.env.NODE_ENV ??= "test";
  process.env.DATABASE_URL ??= DEFAULT_TEST_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET ??=
    "test-secret-that-is-at-least-32-chars-long";
  process.env.BETTER_AUTH_URL ??= "http://localhost:4000";
  process.env.BREVO_API_KEY ??= "xkeysib-test-key";
  process.env.EMAIL_FROM ??= "no-reply@dariise.test";
}

function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set for the test run.");
  }

  const name = new URL(url).pathname.replace(/^\//, "");

  // Guards the `drop schema` below: a developer whose shell exports the
  // development database must not have it wiped by the test suite.
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to reset the non-test database "${name}". Point DATABASE_URL at a database whose name ends in _test.`,
    );
  }

  return url;
}

/** Creates the test database when absent, then applies every migration. */
export async function resetTestDatabase(): Promise<void> {
  loadTestEnv();

  const url = testDatabaseUrl();
  const name = new URL(url).pathname.replace(/^\//, "");

  const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();

  const existing = await admin.query(
    "select 1 from pg_database where datname = $1",
    [name],
  );

  if (existing.rowCount === 0) {
    await admin.query(`create database "${name}"`);
  }

  await admin.end();

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(
    "drop schema if exists public cascade; create schema public;",
  );
  await client.end();

  /**
   * The schema is pushed from `src/db/schema/`, not replayed from `.sql` files.
   *
   * This project is used with `drizzle-kit push`, so there is no migration
   * directory to replay and the schema modules are the only description of the
   * database that exists. Deriving the test schema from the same place as the
   * development one means the two cannot disagree.
   */
  const { pushSchema } = await import("drizzle-kit/api");
  const schema = await import("../db/schema/index.js");
  const { db } = await import("../db/client.js");

  const { apply } = await pushSchema(
    schema as unknown as Record<string, unknown>,
    db as never,
  );

  await apply();
}

/** Empties every table so one test cannot observe another's rows. */
export async function truncateAll(): Promise<void> {
  const { pool } = await import("../db/client.js");
  const { rows } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );

  if (rows.length === 0) return;

  const tables = rows.map((row) => `"${row.tablename}"`).join(", ");

  await pool.query(`truncate table ${tables} restart identity cascade`);
}

export async function closeTestDatabase(): Promise<void> {
  const { closeDatabase } = await import("../db/client.js");
  await closeDatabase();
}

export async function loadApp() {
  loadTestEnv();

  const { app } = await import("../app.js");

  return app;
}

/** An account whose address has not been confirmed yet, so it has no session. */
export interface UnconfirmedUser {
  userId: string;
  email: string;
}

/**
 * Creates an account through Better Auth's own endpoint.
 *
 * `requireEmailVerification` is on, so this deliberately answers without a
 * session and the password stays unusable until the address is confirmed. Use
 * `signUp` for a usable session; reach for this when the confirmation itself is
 * what the test is about.
 */
export async function registerUser(
  app: TestApp,
  name = "Test User",
): Promise<UnconfirmedUser> {
  const email = `test-${randomUUID()}@example.com`;

  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, email, password: TEST_PASSWORD }),
  });

  if (!response.ok) {
    throw new Error(
      `Sign-up failed with ${response.status}: ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { user?: { id?: string } };

  return { userId: body.user?.id ?? "", email };
}

/**
 * Registers a user and confirms the address.
 *
 * The code is read back the way the recipient would read the email — see
 * `verificationCode` — and spent on the real `/email-otp/verify-email`
 * endpoint, which is what issues the session.
 */
export async function signUp(
  app: TestApp,
  name = "Test User",
): Promise<TestSession> {
  const { userId, email } = await registerUser(app, name);

  const verified = await app.request("/api/auth/email-otp/verify-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, otp: await verificationCode(email) }),
  });

  if (!verified.ok) {
    throw new Error(
      `Confirmation failed with ${verified.status}: ${await verified.text()}`,
    );
  }

  return { cookie: readSetCookie(verified), userId, email };
}

/** The kinds of one-time code this deployment issues. */
export type VerificationCodeType = "email-verification" | "forget-password";

/** How long to wait for a code the API issues off the response path. */
const CODE_TIMEOUT_MS = 2_000;

/**
 * The code an email would have carried.
 *
 * Read through Better Auth's own server-only endpoint rather than out of the
 * `verification` table: the codes are encrypted at rest, and the point of that
 * is that nothing but the application can recover them. Reading them this way
 * keeps the storage honest and the test on the real verification path.
 *
 * A code is issued off the response path, so the row may not exist yet when
 * this is called; the wait is for the write, not the mail.
 */
export async function verificationCode(
  email: string,
  type: VerificationCodeType = "email-verification",
): Promise<string> {
  const { auth } = await import("../app.js");
  const deadline = Date.now() + CODE_TIMEOUT_MS;

  for (;;) {
    const { otp } = await auth.api.getVerificationOTP({
      query: { email, type },
    });

    if (otp) return otp;

    if (Date.now() > deadline) {
      throw new Error(`No ${type} code was issued for ${email}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Inserts a workspace and the caller's membership directly. The gate resolves
 * membership from this table on every request, so the rows are the real thing.
 */
export async function seedWorkspace(
  userId: string,
  role = "owner",
): Promise<{ organizationId: string; slug: string }> {
  const { db } = await import("../db/client.js");
  const { member, organization } = await import("../db/schema/index.js");

  const organizationId = randomUUID();
  const slug = `test-${organizationId.slice(0, 8)}`;

  await db
    .insert(organization)
    .values({ id: organizationId, name: "Test Workspace", slug });
  await db
    .insert(member)
    .values({ id: randomUUID(), organizationId, userId, role });

  return { organizationId, slug };
}

export async function seedProject(
  organizationId: string,
  name = "Test Project",
): Promise<{ projectId: string; key: string }> {
  const { db } = await import("../db/client.js");
  const { project } = await import("../db/schema/index.js");

  const projectId = randomUUID();
  const key = `project-${projectId.slice(0, 8)}`;

  await db.insert(project).values({ id: projectId, organizationId, key, name });

  return { projectId, key };
}

export function authHeaders(session: TestSession): Record<string, string> {
  return { cookie: session.cookie };
}

function readSetCookie(response: Response): string {
  const withHelper = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  const values = withHelper.getSetCookie?.() ?? [
    response.headers.get("set-cookie") ?? "",
  ];

  return values
    .map((value) => value.split(";")[0] ?? "")
    .filter((value) => value.length > 0)
    .join("; ");
}
