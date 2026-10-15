# Iwifunni API

The Iwifunni API: a Hono 4 application on Node.js, backed by PostgreSQL through
Drizzle ORM, with Better Auth owning sessions and the identity flows. It serves
the versioned `/v1` wire contract that `packages/contracts` describes and
`apps/web` consumes.

## How It Fits Together

The shape behind every `/v1/projects/:projectKey` path. A project owns its environments,
flags and segments. A flag belongs to the project and carries the variations that every
environment selects among; what it does in one environment is its configuration, one row
per flag and environment, written eagerly when either is created. Enablement, the off and
default variation and the rollout are columns of that row, and the targeting rules and
individual targets hang off it. A targeting rule reaches the project's segments by key.

```text
                            PROJECT
                               │
         ┌─────────────────────┼───────────────────────────┐
         │                     │                           │
   ENVIRONMENTS              FLAGS                     SEGMENTS
                               │                           │
                   ┌───────────┴─────────────┐    Segment Conditions
                   ▼                         ▼
              Variations            FLAG CONFIGURATION
     (shared by every environment) (one per environment)
                                             │
                                     ┌───────┴───────┐
                                     ▼               ▼
                                 Targeting        Targets
                                     │
                                     └──────── references ───────► SEGMENTS
```

## Stack

- Node.js ≥ 20.9, ESM with `module`/`moduleResolution: NodeNext` — relative
  imports carry an explicit `.js`
- Hono 4, served by `@hono/node-server`
- Drizzle ORM over PostgreSQL (`pg`)
- Better Auth — sessions, email codes, OAuth, API keys
- zod v4, with `@iwifunni/contracts` as the shared wire contract
- Brevo and MJML for transactional email
- Vitest for the test suite; Biome for lint and format

## Development

`apps/api` is a workspace package, so dependencies are installed once from the
repository root:

```bash
pnpm install
docker compose up -d postgres                  # PostgreSQL on host port 5442
cp apps/api/.env.example apps/api/.env         # then fill in the required values
pnpm --filter api db:push                      # apply the schema to a local database
pnpm --filter api dev                          # tsx watch src/server.ts
```

The API listens on <http://localhost:4000>. Only PostgreSQL is needed to serve
requests; the full `docker compose up -d` also starts Redis, which nothing
connects to yet.

From the repository root:

| Command                           | Description                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm --filter api dev`           | `tsx watch src/server.ts`                                                                    |
| `pnpm --filter api build`         | `tsc --project tsconfig.build.json`, then copies the `.mjml` templates beside the emitted JS |
| `pnpm --filter api start`         | `node dist/server.js` — run `build` first                                                    |
| `pnpm --filter api typecheck`     | `tsc --noEmit`                                                                               |
| `pnpm --filter api lint`          | `biome lint src`                                                                             |
| `pnpm --filter api format`        | `biome format --write src`                                                                   |
| `pnpm --filter api test`          | `vitest run`                                                                                 |
| `pnpm --filter api check`         | `typecheck` + `lint` + `test` for this workspace                                             |
| `pnpm --filter api db:generate`   | Generate SQL from the schema barrel into `apps/api/drizzle`                                  |
| `pnpm --filter api db:push`       | Apply the schema straight to a database — local only                                         |
| `pnpm --filter api db:migrate`    | Apply committed migrations; none are committed, so it has nothing to replay                  |
| `pnpm --filter api auth:generate` | Run Better Auth's CLI to diff its expected tables against the hand-written ones              |

Most have a root alias that reaches this workspace — `pnpm dev:api`,
`pnpm build`, `pnpm test`, `pnpm check`, `pnpm db:generate`, `pnpm db:push`,
`pnpm db:migrate`. `format` and `auth:generate` have none. The full command
table, including the port assignments and the Docker stack, is in
[`docs/development.md`](../../docs/development.md).

`build` emits only JavaScript, so `scripts/copy-email-templates.mjs` copies
`src/modules/email/templates/` beside it; without that, `node dist/server.js`
boots with no templates to render.

### Database and the schema workflow

Tables live in `src/db/schema/`, one file per table, appended to the
`src/db/schema/index.ts` barrel — `drizzle.config.ts` points at that barrel, so
a table missing from it is never migrated. Repositories are the only code that
imports a table.

No migration SQL is committed, so the working command is `db:push`.
`db:generate` is what will produce a migration directory, and `db:migrate` will
replay one once it exists. `db:push` is for local databases only. Audit rows go
through `src/db/audit.ts` with the mutation's transaction, never after commit.

## Layout

```text
apps/api/
├── src/
│   ├── app.ts                    # composition root: middleware, mounts, error boundary
│   ├── server.ts                 # Node listener and graceful shutdown
│   ├── config/
│   │   ├── index.ts              # loads .env, validates it, exports `env`
│   │   └── schema.ts             # the zod config schema
│   ├── db/
│   │   ├── client.ts             # the pg pool and the drizzle instance
│   │   ├── audit.ts              # the audit-row helper
│   │   └── schema/               # one file per table, plus the index.ts barrel
│   ├── integrations/brevo/       # transactional-email transport
│   ├── middleware/
│   │   └── authorization.ts      # session middleware + requireSession/requireWorkspace
│   ├── modules/                  # one folder per domain (see below)
│   ├── shared/
│   │   ├── constants.ts          # ERROR_CODE, enabledProviders
│   │   ├── http/errors.ts        # ApiError, its factories, errorResponse
│   │   ├── pagination.ts         # encodeCursor, decodeCursor, toPage
│   │   └── types/                # cross-module types
│   └── test/                     # harness, cross-cutting suites, modules/, shared/
├── scripts/copy-email-templates.mjs
├── drizzle.config.ts
├── biome.json
├── vitest.config.ts
└── tsconfig.json                 # tsconfig.build.json excludes src/test/
```

Every module folder follows the same file convention: `<name>.routes.ts`,
`.controller.ts`, `.service.ts`, `.repository.ts`, `.types.ts`, an optional
`.mapper.ts` for row → DTO, and an `index.ts` for its public surface.

## Modules

| Module            | Serves                                                    | Owns                                                                                      |
| ----------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `account`         | `/v1/me` writes                                           | Profile, password, preferences and notification updates                                   |
| `api-keys`        | `/v1/projects/:projectKey/api-keys`                       | Listing, creating and revoking an environment's key                                       |
| `audit-log`       | `/v1/audit-logs`                                          | The workspace-wide and project-scoped audit pages                                         |
| `auth`            | `/api/auth/*`, `/v1/auth/providers`, `/v1/me`             | Better Auth's handler, enabled providers, the caller's identity                           |
| `change-requests` | `/v1/projects/:projectKey/flags/:flagKey/change-requests` | Proposing, approving and rejecting a change to a protected environment                    |
| `email`           | —                                                         | Template rendering and delivery; consumed by `auth`                                       |
| `environments`    | `/v1/projects/:projectKey/environments`                   | Environment CRUD, the protected setting, archive and unarchive                            |
| `evaluation`      | `/v1/evaluate`                                            | Resolving one flag for a caller                                                           |
| `flags`           | `/v1/flags`, `/v1/projects/:projectKey/flags`             | Flag identity, variations, per-environment config, rules, targets, versions, dependencies |
| `project-access`  | —                                                         | The shared authorization gate every project-scoped service calls                          |
| `project-members` | `/v1/projects/:projectKey/members`                        | Listing, adding, re-roling and removing a member                                          |
| `projects`        | `/v1/projects`                                            | Project CRUD, including the compound create                                               |
| `segments`        | `/v1/projects/:projectKey/segments`                       | Segment CRUD and the flags that reference one                                             |
| `workspace`       | `/v1/workspace`                                           | The workspace profile and its security settings                                           |

A routes file owns its paths; `app.ts` owns construction and mounting. Routers
mounted at `/v1/projects` register paths below that prefix, while a module whose
paths span prefixes (`auth`, `flags`, `audit-log`, `account`, `evaluation`,
`workspace`) is mounted at `/` and spells out its `/v1` paths itself.

The endpoint-by-endpoint inventory is
[`docs/api-conventions.md` § Route inventory](../../docs/api-conventions.md) —
it is the durable list, kept in one place rather than repeated here.

## Architecture

The layering is one-directional: `controller → service → repository`. Nothing
skips a layer or goes backward.

- **`app.ts` is the only composition root.** It constructs every repository,
  service, controller and router in dependency order, and registers the global
  middleware and mounts before the modules. It holds no business logic.
- **A module reaches another module through its `index.ts` only.** Where two
  modules need each other, `app.ts` injects the dependency instead: `flags`
  receives a segment-key lookup, `environments` receives the flag
  initialisation it delegates to, `projects` receives environment seeding,
  `change-requests` receives the flag validate/apply pair, and `auth` receives a
  project-existence check.
- **Each layer is a class, and the file exports only the class** — never a
  module-level instance. Dependencies arrive through the constructor.
- **Routes apply the session middleware on the router**, per module, rather than
  globally; the auth router applies it to `/v1/me` alone, and
  `/v1/auth/providers` is public. `app.ts` builds one instance and hands it to
  the factories.
- **Controllers stay thin**: read the input, `safeParse` it against a
  `packages/contracts` schema, call one service method, return its result.
  Business rules and authorization live in the service.
- **Every query is scoped by the session's `organizationId`**, never by a body
  field, query parameter or path segment. A cross-tenant read answers 404, not
  403, so a 403 cannot confirm that a resource exists.

Better Auth owns its own tables through the Drizzle adapter; `auth.repository.ts`
holds only the reads Iwifunni needs. The decision record is
[`docs/architecture.md`](../../docs/architecture.md), and the long-form module,
routing, contract and validation rules are in
[`.agents/skills/api/skill.md`](../../.agents/skills/api/skill.md).

### The error contract

Every Iwifunni failure is rendered by `errorResponse`, the single handler passed
to `app.onError`. Failures are built with the `ApiError` factories and returned
as:

```json
{ "error": { "code": "not_found", "message": "…", "details": {} } }
```

`details` is present only when the factory was given it.

| Code                | Status | Raised by                                                                 |
| ------------------- | ------ | ------------------------------------------------------------------------- |
| `invalid_request`   | 400    | `ApiError.badRequest` — a failed `safeParse` or a rejected value          |
| `unauthorized`      | 401    | `ApiError.unauthorized`, `requireSession`                                 |
| `forbidden`         | 403    | `ApiError.forbidden` — the caller is known but not permitted              |
| `not_found`         | 404    | `ApiError.notFound` — includes every cross-tenant read                    |
| `conflict`          | 409    | `ApiError.conflict` — a duplicate key or a referenced value               |
| `approval_required` | 409    | `ApiError.approvalRequired` — a direct publish to a protected environment |
| `internal_error`    | 500    | Any unexpected error, logged and returned with no internals               |

Better Auth's `/api/auth/*` error contract is its own and is never wrapped.

## Configuration

`src/config/index.ts` imports `dotenv/config`, parses `process.env` with the
`ConfigSchema` in `src/config/schema.ts`, and exports the validated `env`. It is
the only module in this app that reads `process.env`; a missing or malformed
required value throws at startup, listing every offending key, rather than
failing on the first request that needs it. Copy `apps/api/.env.example`.

| Variable                                    | Required | Default                 | Purpose                                                                            |
| ------------------------------------------- | -------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | Yes      | —                       | PostgreSQL connection string                                                       |
| `BETTER_AUTH_SECRET`                        | Yes      | —                       | Session signing secret; at least 32 characters                                     |
| `BREVO_API_KEY`                             | Yes      | —                       | Transactional email for verification and reset codes                               |
| `EMAIL_FROM`                                | Yes      | —                       | Sender address; must be verified in your Brevo account                             |
| `BETTER_AUTH_URL`                           | No       | `http://localhost:4000` | The origin the browser reaches the API on                                          |
| `PORT`                                      | No       | `4000`                  | API listen port                                                                    |
| `NODE_ENV`                                  | No       | `development`           | `development`, `test` or `production`                                              |
| `DATABASE_POOL_MAX`                         | No       | `10`                    | Max connections this process opens; keep instances × this below the server's limit |
| `REDIS_URL`                                 | No       | —                       | Parsed but not connected — see below                                               |
| `EMAIL_SENDER_NAME`                         | No       | `Iwifunni`               | Sender name shown in the recipient's inbox                                         |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | No       | —                       | GitHub sign-in; needs both values or the provider is disabled                      |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | No       | —                       | Google sign-in; needs both values or the provider is disabled                      |

The registered redirect URIs for social sign-in are
`http://localhost:4000/api/auth/callback/github` and `.../google`; GitHub needs
the `user:email` scope. `src/shared/constants.ts` derives `enabledProviders`
from the four optional values, which is how `/v1/auth/providers` and `/v1/me`
report which buttons the dashboard may offer.

## Operational endpoints

| Endpoint       | Answers                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz` | Liveness. `{ "status": "ok" }`, with no database access                                                                |
| `GET /readyz`  | Readiness. `select 1` against PostgreSQL, then `{ "status", "checks" }` — 200 when the database answers, 503 otherwise |

`/readyz` reports `redis: "not_configured"`: `REDIS_URL` is validated so it can
be set, but nothing in the codebase opens a connection, and readiness does not
depend on one. Redis is intended as a configuration cache, never on the critical
path ([`docs/architecture.md` §8.1](../../docs/architecture.md)).

`src/server.ts` closes the listener before draining the pool on `SIGTERM` or
`SIGINT`, so in-flight requests finish; a second signal exits immediately
instead of hanging on a stuck connection.

## Testing

The suite runs on Vitest against a real PostgreSQL database. Every test lives
under `src/test/`; `vitest.config.ts` includes only `src/test/**/*.test.ts`, so a
`*.test.ts` file colocated with its source is ignored rather than run twice.

```text
src/test/
├── harness.ts               no tests: loadTestEnv, resetTestDatabase, truncateAll,
│                            loadApp, signUp, seedWorkspace, authHeaders
├── harness.test.ts          the harness's own coverage
├── acceptance.test.ts       end-to-end claims driven through the app
├── route-coverage.test.ts   route-level edges and pagination
├── modules/                 one suite per module, plus unit suites
└── shared/                  email templates, rendering, substitution, Brevo transport
```

- Requests go through `app.request()` — a plain function call, with no listener,
  no bound port and no `supertest`.
- `fileParallelism: false` in `vitest.config.ts`: every integration suite shares
  one test database, and concurrent workers would truncate or re-migrate it
  underneath each other.
- `loadTestEnv()` falls back to `postgresql://postgres:postgres@localhost:5442/iwifunni_test`
  and `resetTestDatabase()` creates that database when it is absent.
- The reset refuses to run unless the database name ends in `_test`, which is
  what stops a test run from wiping the development database. Isolation is by
  truncation after each test, not by rolled-back transactions.

```bash
pnpm --filter api test
pnpm --filter api exec vitest run src/test/harness.test.ts
pnpm --filter api exec vitest run -t "the role matrix"
```

[`docs/testing.md`](../../docs/testing.md) covers the runner, the database and
what each suite is expected to cover.

## What is not built

Stated here so a reader does not have to discover it from a 404 or an empty
screen:

- **No OpenAPI document.** `/v1/openapi.json` is not served and no specification
  is generated from the contracts ([`docs/api-conventions.md`](../../docs/api-conventions.md)).
- **No Redis client.** `REDIS_URL` is parsed; readiness reports it as
  `not_configured`.
- **No migrations committed.** The schema is applied with `db:push`, so
  `db:migrate` exits non-zero today.
- **No SDK authentication on `/v1/evaluate`**, and no rate limiting or webhooks.
- **No metrics or analytics route.** Analytics figures in the dashboard are
  fixtures, not data from here.
- **No project archive or soft delete**, and no API-key rename or rotation.
- **Two list endpoints return a bare array with no cursor**: `GET /v1/projects`
  and `GET /v1/projects/:projectKey/members`.
