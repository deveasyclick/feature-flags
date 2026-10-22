import { createHmac } from "node:crypto";
import { beforeAll, afterAll, afterEach, expect, it } from "vitest";
import {
  loadApp,
  loadTestEnv,
  resetTestDatabase,
  truncateAll,
  closeTestDatabase,
  signUp,
  seedWorkspace,
  seedProject,
  TEST_PASSWORD,
} from "../harness.js";

let app: Awaited<ReturnType<typeof loadApp>>;
beforeAll(async () => {
  loadTestEnv();
  await resetTestDatabase();
  app = await loadApp();
});
afterEach(truncateAll);
afterAll(closeTestDatabase);

function cookie(response: Response, previous = ""): string {
  const jar = new Map(
    previous
      .split(";")
      .filter(Boolean)
      .map((pair) => {
        const at = pair.indexOf("=");
        return [pair.slice(0, at).trim(), pair.slice(at + 1)];
      }),
  );
  for (const item of response.headers.getSetCookie()) {
    const pair = item.split(";")[0];
    if (!pair) continue;
    const at = pair.indexOf("=");
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

function totp(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("Enrollment omitted its secret.");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replace(/=+$/, "")]
    .map((letter) => alphabet.indexOf(letter).toString(2).padStart(5, "0"))
    .join("");
  const bytes = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", bytes).update(counter).digest();
  const offset = hash.readUInt8(hash.length - 1) & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(
    6,
    "0",
  );
}

function post(path: string, body: unknown, sessionCookie = "") {
  return app.request(`/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify(body),
  });
}

it("requires a verified factor for sessions, completes sign-in and consumes recovery codes once", async () => {
  const user = await signUp(app);
  const workspace = await seedWorkspace(user.userId, "owner");
  await seedProject(workspace.organizationId);
  const enabled = await post(
    "/two-factor/enable",
    { password: TEST_PASSWORD },
    user.cookie,
  );
  expect(enabled.status).toBe(200);
  const enrollment = (await enabled.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  expect(enrollment.backupCodes).toHaveLength(10);
  const verification = await post(
    "/two-factor/verify-totp",
    { code: totp(enrollment.totpURI) },
    user.cookie,
  );
  expect(verification.status).toBe(200);
  const verifiedCookie = cookie(verification, user.cookie);
  const allowed = await app.request("/v1/projects", {
    headers: { cookie: verifiedCookie },
  });
  expect(allowed.status).toBe(200);
  expect(
    (await app.request("/v1/me", { headers: { cookie: user.cookie } })).status,
  ).toBe(401);
  const login = await post("/sign-in/email", {
    email: user.email,
    password: TEST_PASSWORD,
  });
  expect(login.status).toBe(200);
  await expect(login.clone().json()).resolves.toMatchObject({
    twoFactorRedirect: true,
  });
  const pendingCookie = cookie(login);
  expect(
    (await app.request("/v1/projects", { headers: { cookie: pendingCookie } }))
      .status,
  ).toBe(401);
  const recovered = await post(
    "/two-factor/verify-backup-code",
    { code: enrollment.backupCodes[0] },
    pendingCookie,
  );
  expect(recovered.status).toBe(200);
  const recoveredCookie = cookie(recovered, pendingCookie);
  expect(
    (
      await app.request("/v1/projects", {
        headers: { cookie: recoveredCookie },
      })
    ).status,
  ).toBe(200);
  const reused = await post(
    "/two-factor/verify-backup-code",
    { code: enrollment.backupCodes[0] },
    recoveredCookie,
  );
  expect(reused.ok).toBe(false);

  const { db } = await import("../../db/client.js");
  const { session, twoFactor } = await import("../../db/schema/index.js");
  const { eq } = await import("drizzle-orm");
  const factors = await db.select().from(twoFactor);
  expect(factors[0]?.secret).not.toContain(
    new URL(enrollment.totpURI).searchParams.get("secret"),
  );
  expect(factors[0]?.backupCodes).not.toContain(enrollment.backupCodes[1]);
  await db
    .update(session)
    .set({ twoFactorVerifiedAt: null })
    .where(eq(session.userId, user.userId));
  const refused = await app.request("/v1/projects", {
    headers: { cookie: recoveredCookie },
  });
  expect(refused.status).toBe(403);
  await expect(refused.json()).resolves.toMatchObject({
    error: { code: "mfa_required" },
  });
  expect(
    (
      await post(
        "/two-factor/disable",
        { password: TEST_PASSWORD },
        recoveredCookie,
      )
    ).status,
  ).toBe(403);
});

it("enforces workspace enrollment on existing sessions and refuses disabling a required factor", async () => {
  const user = await signUp(app);
  const workspace = await seedWorkspace(user.userId, "owner");
  await seedProject(workspace.organizationId);
  const { db } = await import("../../db/client.js");
  const { organization } = await import("../../db/schema/index.js");
  const { eq } = await import("drizzle-orm");
  await db
    .update(organization)
    .set({ metadata: JSON.stringify({ security: { twoFactorEnabled: true } }) })
    .where(eq(organization.id, workspace.organizationId));
  const refused = await app.request("/v1/projects", {
    headers: { cookie: user.cookie },
  });
  expect(refused.status).toBe(403);
  await expect(refused.json()).resolves.toMatchObject({
    error: { code: "mfa_enrollment_required" },
  });
  const enabled = await post(
    "/two-factor/enable",
    { password: TEST_PASSWORD },
    user.cookie,
  );
  expect(enabled.status).toBe(200);
  const enrollment = (await enabled.json()) as { totpURI: string };
  const verified = await post(
    "/two-factor/verify-totp",
    { code: totp(enrollment.totpURI) },
    user.cookie,
  );
  expect(verified.status).toBe(200);
  const verifiedCookie = cookie(verified, user.cookie);
  expect(
    (await app.request("/v1/projects", { headers: { cookie: verifiedCookie } }))
      .status,
  ).toBe(200);
  expect(
    (
      await post(
        "/two-factor/disable",
        { password: TEST_PASSWORD },
        verifiedCookie,
      )
    ).status,
  ).toBe(403);
});
