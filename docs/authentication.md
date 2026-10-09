# Authentication

Dariise delegates identity to Better Auth and adds no password hashing, session store
or link-based confirmation of its own. This covers the identity layer, the emailed
codes, social sign-in, the two credential kinds and the origin arrangement today.

Owned elsewhere: `docs/authorization.md` (role matrix and gate),
`docs/api-conventions.md` (envelope and exception), `docs/development.md`
(environment and setup), `docs/domain-model.md` (tenancy tree), `docs/flags.md`
(key issuance in the UI).

## Better Auth is the identity layer

`createAuthConfig(emailService)` in `apps/api/src/modules/auth/auth.config.ts`
builds the instance; `app.ts` is its only caller, exporting it as `auth` and
injecting `auth.api.getSession` and the credential operations into `AuthService`.

The plugins are `organization()` and `emailOTP({ ... })`. `app.ts` exports `auth`
beside `app` because the plugin surface has server-only endpoints the suite depends
on — chiefly `auth.api.getVerificationOTP`, which reads a code back the way a
recipient would (`apps/api/src/test/harness.ts`).

It is mounted as a raw pass-through,
`routes.all("/api/auth/*", (c) => authHandler(c.req.raw))`. Dariise does **not** wrap
this error contract: the responses carry Better Auth's own `{ code, message }` shape
rather than the API envelope; see `docs/api-conventions.md`.

## The workspace is the organization

There is no separate tenant table: the workspace **is** the Better Auth
organization, and the plugin's `organization`, `member` and `invitation` tables are
the tenancy records. `AuthRepository.findWorkspaceForUser` inner-joins `member` to
`organization` and returns the first row as `{ id, name, slug, role }`.

The dashboard creates a workspace with
`authClient.organization.create({ name, slug })` and nothing else; the plugin adds
the creator as `owner` (`apps/web/lib/auth.ts`). That the workspace and the
Better Auth organization are the same record is stated here; see
`docs/architecture.md §2` and `docs/domain-model.md`. The lookup is `limit(1)`.

## Session resolution

`AuthService.resolveRequestContext(headers)` asks Better Auth for the session,
returns `null` when there is none, and otherwise resolves the membership and an
injected project-existence check.

`createSessionMiddleware(resolve)` in `apps/api/src/middleware/authorization.ts`
takes a `SessionResolver`, `(headers) => Promise<RequestContext | null>`, so the
file imports no service class or instance. `requireSession(c)` throws
`ApiError.unauthorized()`; `requireWorkspace(c)` throws `ApiError.notFound` when no
membership exists.

The middleware is applied **per router**, not globally: `app.ts` builds one instance
and each router decides where it runs. The auth router attaches it to `GET /v1/me`
alone, so `/api/auth/*` and `GET /v1/auth/providers` resolve nothing; the rest use
`routes.use("*", sessionMiddleware)`. Controllers read the context the gate resolved
and never touch Better Auth directly.

## Email one-time-code flows

Verification and password reset use codes the user types in, not links. `emailOTP`
is installed with `overrideDefaultEmailVerification: true`, replacing
`sendVerificationEmail` so no link pointing at the API origin is ever built. Codes
are six digits, expire in ten minutes and are stored encrypted under the app secret.

`sendVerificationOTP` picks the reset or confirmation template and calls
`EmailService.send`, which renders it and hands it to the `EmailTransport` — Brevo's
HTTP API, where `BrevoTransport` wraps `@getbrevo/brevo`'s `BrevoClient`.
`BREVO_API_KEY` and `EMAIL_FROM` are required and validated at startup by
`ConfigSchema`; `EMAIL_SENDER_NAME` defaults to `Dariise`, and there is no
`emailEnabled` flag.

The endpoints are `/api/auth/email-otp/send-verification-otp`, `/verify-email`,
`/request-password-reset` and `/reset-password`. `requireEmailVerification` is on,
so sign-up returns no session until the address is confirmed.

The request endpoints answer identically for a known and an unknown address — the
suite asserts this for the reset request (`apps/api/src/test/modules/auth.test.ts`)
and `apps/web/lib/auth.ts` documents the same for a confirmed or waiting address —
so the form cannot be used to discover which accounts exist.

## Social sign-in and the providers endpoint

Providers are `github` and `google` (`OAUTH_PROVIDERS` in
`packages/contracts/src/oauth.ts`). `enabledProviders` in
`apps/api/src/shared/constants.ts` is the source of truth: a provider is enabled
only when **both** its client id and its client secret are set, so a half-configured
provider is treated as absent, and a deployment carrying half a pair starts with
that provider disabled.

The redirect URI registered with each provider is the API's own callback path,
`http://localhost:4000/api/auth/callback/github` and
`http://localhost:4000/api/auth/callback/google`. GitHub must be granted the
`user:email` scope or sign-in fails with `email_not_found`.

`GET /v1/auth/providers` returns the derived list from `providersForDeployment()`
and is mounted without the session middleware, so it answers before a caller exists.
The dashboard's `getEnabledProviders` fails closed: a non-ok response or a thrown
fetch yields an empty list, because the call runs while rendering the access screens
and throwing would replace the sign-in form with an error page when the API is
unreachable.

## The two credential kinds

The two credentials are not interchangeable.

A **session cookie** is issued by Better Auth for the dashboard. It is first-party
to the API origin, `httpOnly`, and the browser sends it with `credentials: "include"`.
An **environment-scoped API key** is for evaluation by customer applications.
`POST /v1/projects/:projectKey/api-keys` returns the secret exactly once and stores
only its `sha256` hash in `api_keys.secret_hash`; the `ff_`-prefixed prefix is the
non-secret identifier the dashboard lists. A key can be scoped to one environment,
with an absent key meaning every environment; it carries `scopes` from `API_KEY_SCOPES`
and can be given an expiry. Listing is viewer-level; issuing and revoking are
admin-level, and revoking sets `revokedAt`.

**The current gap.** `POST /v1/evaluate` is gated by `requireWorkspace`, so it
requires a session cookie. Nothing reads `secret_hash` for authentication and
`last_used_at` is never written, so no key can actually be used for evaluation yet.
See `docs/architecture.md §9`.

## The origin and cookie arrangement today

The dashboard and the API are separate origins in development: the web app reads
`NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:4000`, while the dashboard
runs on `http://localhost:3000`. The API answers CORS from the origin allowlist in
`src/app.ts` with `credentials: true`, and `src/modules/auth/auth.config.ts` hands the
same origins to Better Auth as `trustedOrigins`; both compare the `Origin` header as an
exact string, so an entry carries no trailing slash. The browser client sends
`credentials: "include"` against the API
base URL (`apps/web/lib/auth-client.ts`), so the cookie is cross-origin in
development, and `BETTER_AUTH_URL` must match the origin the browser reaches the
API on.

The intended production arrangement is the API proxied under the web origin so the
cookie is first-party — a future commitment, not today's behaviour, and **not**
implemented with Next.js rewrites. See `docs/architecture.md §8.3`.

## Account and profile endpoints

Two modules share the `/v1/me` resource. The auth module owns the read: `GET /v1/me`
is gated by the session middleware and returns `{ user, workspace, hasProject,
providers }`. The account module owns the writes, all gated: `PATCH /v1/me` (display
name), `POST /v1/me/password`, `PATCH /v1/me/preferences` and `PATCH /v1/me/notifications`.

`PATCH /v1/me` rejects an email change with a 400, because changing the sign-in
address needs a verification step this release does not include and must never
quietly mark a new address verified. Only the name reaches
`AuthService.updateDisplayName`, which delegates to `auth.api.updateUser`.

**The asymmetry.** Preferences and notifications can be written but not read back:
only `PATCH` exists for either path, and there is no `GET`. A save returns the
resulting `UserPreferences`, but nothing reads the stored values back later.

## Status

**Exists today.** Better Auth with the organization and email OTP plugins and the
raw `/api/auth/*` mount; email and password with mandatory confirmation and account
linking; emailed codes for confirmation and reset over Brevo; GitHub and Google
sign-in; `createSessionMiddleware` with `requireSession` and `requireWorkspace`;
`GET /v1/me`; the account writes; and API key issuance, listing and revocation with
hash-only storage.

**Partial.** Workspace resolution reads a single membership row. Preferences and
notifications are write-only.

**Not built.** API key authentication for evaluation: `/v1/evaluate` still requires
a session and `last_used_at` is never written. The production same-origin cookie
arrangement. Any enable flag for email.

## Where it lives

- `apps/api/src/modules/auth/auth.config.ts` — the Better Auth instance and its plugins.
- `apps/api/src/modules/auth/auth.service.ts` — session resolution, credential operations.
- `apps/api/src/modules/auth/auth.routes.ts` — the `/api/auth/*` mount and two `/v1` routes.
- `apps/api/src/modules/auth/auth.repository.ts` — membership joined to organization.
- `apps/api/src/modules/auth/auth.types.ts` — `RequestContext`, `SessionEnv`, code TTL.
- `apps/api/src/middleware/authorization.ts` — session middleware factory and gates.
- `apps/api/src/modules/account/account.service.ts` — profile, password, preference writes.
- `apps/api/src/modules/api-keys/api-keys.service.ts` — key issuance, hashing, revocation.
- `apps/api/src/db/schema/api-keys.ts` — the `api_keys` table.
- `apps/api/src/modules/email/email.service.ts` — render then send, without throwing.
- `apps/api/src/integrations/brevo/brevo.transport.ts` — the Brevo email client.
- `apps/api/src/config/schema.ts` — startup validation of auth, OAuth and email variables.
- `apps/api/src/shared/constants.ts` — `enabledProviders`, the OAuth source of truth.
- `apps/api/src/app.ts` — composition root, shared session middleware and mounts.
- `packages/contracts/src/auth.ts` — sign-in, sign-up and code-flow schemas.
- `packages/contracts/src/oauth.ts` — provider enum and providers response.
- `packages/contracts/src/api-key.ts` — key kinds, scopes and the create-only secret.
- `apps/web/lib/auth-client.ts` — the Better Auth client and error mapping.
- `apps/web/lib/auth.ts` — the flows the access and onboarding screens drive.
- `apps/api/src/test/harness.ts` — reading an issued code through the server-only endpoint.
