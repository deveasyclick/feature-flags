# Testing

The API test suite runs on vitest against a real PostgreSQL database. Every test lives under `apps/api/src/test/`; the dashboard has no test suite. This document covers the runner, the database it uses, and what the suites assert. Commands for local setup beyond the test runner belong to `docs/development.md`.

## Running the tests

| Where | Command |
| --- | --- |
| repo root | `pnpm test` — the root script is `pnpm --recursive test` |
| repo root | `pnpm --filter api test` — the API workspace alone |
| repo root | `pnpm --filter api exec vitest run src/test/harness.test.ts` |
| `apps/api` | `pnpm test` |
| `apps/api` | `pnpm exec vitest run src/test/harness.test.ts` |
| `apps/api` | `pnpm exec vitest run -t "the role matrix"` |

`vitest run [filters...]` treats positional arguments as file-path filters; `-t` / `--testNamePattern` selects by full test name, describe block included.

`apps/api/package.json` defines `test` as `vitest run`. The root `test` script is `pnpm --recursive test`, and `apps/api` is the only workspace that defines a `test` script — `apps/web` and `packages/contracts` do not — so `pnpm test` runs the API suite. `pnpm check` runs `typecheck`, `lint` and `test` across every workspace.

## Where tests live

```text
apps/api/src/test/
├── harness.ts               no tests: the shared helpers
├── harness.test.ts          the harness's own coverage
├── acceptance.test.ts       end-to-end claims, driven through the app
├── route-coverage.test.ts   route-level edges and pagination
├── modules/                 one suite per API module
└── shared/                  shared infrastructure
```

`apps/api/vitest.config.ts` includes `src/test/**/*.test.ts`. The pattern is deliberately narrow so a `*.test.ts` colocated with its source is ignored rather than run twice: the rule is to put a test under `src/test/`. `harness.ts` matches no include pattern, so the helpers are never collected as a suite.

`modules/` holds route suites driven through the app alongside unit suites such as `project-access.service.test.ts`; the engine and SDK packages test themselves under `packages/engine/src/` and `packages/sdk-node/src/`; `shared/` covers email templates, rendering and substitution, the email service and the Brevo transport.

## Sequential execution

`vitest.config.ts` sets `fileParallelism: false`, so files run one at a time. Every integration suite shares a single test database: concurrent workers would truncate or re-migrate it underneath each other.

## The test database

`loadTestEnv()` assigns `DATABASE_URL` only when nothing already set it, falling back to the default test database `postgresql://postgres:postgres@localhost:5442/iwifunni_test`. `resetTestDatabase()` creates that database when it is absent, connecting as an administrator to `TEST_ADMIN_DATABASE_URL` when set, otherwise to `postgresql://postgres:postgres@localhost:5442/postgres`. `TEST_ADMIN_DATABASE_URL` is read once when `harness.ts` is imported, so it has to be in the environment before the test file loads; `DATABASE_URL` is read when the reset runs.

The prerequisite is a reachable PostgreSQL instance and a test database whose name ends in `_test`, with the database created when missing — so the role behind the admin URL needs that privilege. `docker-compose.yml` publishes PostgreSQL on port 5442 but creates only the development database `iwifunni`; `iwifunni_test` is the suite's own.

Before anything is dropped, `testDatabaseUrl()` takes the pathname out of `DATABASE_URL` and refuses to continue unless the name ends in `_test`, throwing `Refusing to reset the non-test database "<name>". Point DATABASE_URL at a database whose name ends in _test.` That guard is what makes the naming rule load-bearing: the reset drops and recreates the `public` schema, so a developer whose shell exports the development `DATABASE_URL` — `apps/api/.env.example` points at `.../iwifunni` — would otherwise have the development database wiped by a test run. `loadTestEnv` assigns with `??=`, and `dotenv`, loaded by `src/config/index.ts`, does not override variables already present, so an exported value is exactly the one the guard sees.

## Isolation by truncation

Isolation is by truncation, not by rolled-back transactions. `harness.ts` gives the reason: the app's `db` is a module-level pool and services open their own transactions, so a single wrapping transaction cannot be injected without restructuring the composition root.

`resetTestDatabase()`, called once per file from `beforeAll`:

1. connects to the admin database and runs `create database "<name>"` when `pg_database` holds no such row;
2. connects to the test database and runs `drop schema if exists public cascade; create schema public;`;
3. applies the schema with `pushSchema` from `drizzle-kit/api`, built from `src/db/schema/index.ts`.

Step 3 pushes from the schema modules rather than replaying `.sql` files. The project is used with `drizzle-kit push` and the repository has no `apps/api/drizzle` migration directory, so the schema modules are the only description of the database that exists; deriving the test schema from the same place as the development one means the two cannot disagree.

`truncateAll()` empties every table between tests: it reads `pg_tables` for schema `public`, issues `truncate table ... restart identity cascade`, and returns early when there are no tables. Every integration suite calls it from `afterEach`, so one test cannot observe another's rows. `harness.test.ts` covers the behaviour directly: the test that follows a committed project asserts the table is empty, and fails without the truncation. `closeTestDatabase()` closes the pool from `afterAll`.

The api skill's Tests section describes integration coverage as rolled back per test; the harness implements truncation instead, for the reason above.

## Environment ordering

`loadTestEnv()` must run before the first import of `src/config/index.ts`. That module parses `process.env` through its zod schema at module load and throws `Invalid environment configuration:` with the list of issues when the parse fails, so the test variables have to be in place first — and the pool built from that configuration has to point at the test database.

The test files use dynamic imports for this reason: `harness.test.ts` calls `loadTestEnv()`, then `resetTestDatabase()`, then `loadApp()` inside `beforeAll`, holding the app in a module-level binding the tests await.

`loadApp()` calls `loadTestEnv()` itself and then `await import("../app.js")`. A static `import { app } from "../app.js"`, or a static import of `../db/client.js`, is hoisted and evaluated before the module body runs, so `loadTestEnv()` never gets its turn and the run fails on configuration — or builds its pool against the wrong database. `harness.ts` imports no application code at the top level; its helpers dynamically import `../db/client.js`, `../db/schema/index.js` and `../app.js` when they are called. `AGENTS.md` records the same exception: the test harness writes `process.env` before config loads.

`loadTestEnv()` sets each variable only when it is unset:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `test` |
| `DATABASE_URL` | the default test database above |
| `BETTER_AUTH_SECRET` | `test-secret-that-is-at-least-32-chars-long` |
| `BETTER_AUTH_URL` | `http://localhost:4000` |
| `BREVO_API_KEY` | `xkeysib-test-key` |
| `EMAIL_FROM` | `no-reply@iwifunni.test` |

## Routes through app.request()

Routes are exercised with `app.request(path, init)` — a plain function call on the exported Hono app. No listener is started, no port is bound, and `supertest` is not used. `TestApp` is the minimal shape the helpers accept, `{ request(input, init): Response | Promise<Response> }`, so they work with any Hono app without threading the router's context type through the tests.

A signed-in session comes from `signUp(app)`, which drives Better Auth's own endpoints:

1. `POST /api/auth/sign-up/email` with `TEST_PASSWORD`. `registerUser()` exposes that step alone: with `requireEmailVerification` on, it deliberately answers without a session and the password stays unusable until the address is confirmed.
2. The code is read through `auth.api.getVerificationOTP`, Better Auth's server-only endpoint, rather than out of the `verification` table — the codes are encrypted at rest, and reading them this way keeps the test on the real verification path. A code is issued off the response path, so the helper polls for it for up to two seconds.
3. `POST /api/auth/email-otp/verify-email` with the code issues the session; the helper takes the session cookie from `set-cookie`.

`seedWorkspace(userId, role)` inserts the `organization` and `member` rows directly with Drizzle, defaulting the role to `owner`; `seedProject(organizationId, name)` inserts a `project` row for suites that need one without the create route. These are fixtures, not stubs: the authorization gate resolves membership from those tables on every request. `authHeaders(session)` returns `{ cookie }`, and suites that post JSON build `{ "content-type": "application/json", cookie: session.cookie }` locally.

## What the suite covers

- The authorization boundary, not only the happy path. `acceptance.test.ts` walks the role matrix: a viewer reads but every write is refused, an engineer writes flags and segments but not environments, keys or members, and a workspace admin is an implicit project admin while renaming the project itself stays owner-only.
- Workspace isolation across two tenants, and the not-found-for-another-tenant rule: a caller from another workspace receives 404, never 403. `project-access.integration.test.ts` adds a workspace member with no project row, an unrecognised stored role, a role change applied on the very next request, and access revoked as soon as the membership row goes.
- The onboarding gates, including the Development and Production environments created with the project and the onboarding state reported through `/v1/me`.
- The evaluation engine as a pure function, with a case per evaluation reason: `flag_archived`, `flag_disabled`, `targeting_rule`, `segment`, `percentage_rollout` and `default_variation` are each asserted, along with bucketing and rule-level rollout gating.
- `/healthz` and `/readyz` against a migrated but empty database, which is the state every first run starts from; `/readyz` reports `database: "ok"` and `redis: "not_configured"`.

## A test must be able to fail

An assertion that cannot distinguish the behaviour it names is not coverage: a property checked on a value that could never carry it, or a mock that is never reached. For each negative assertion, the question is what would change in the code for it to fail; if nothing would, assert on the real accessor instead. The api skill states the rule with a worked example — `new Headers(init.headers).get("api-key")` rather than `toHaveProperty("X-api-key")`, because the SDK sends a `Headers` instance whose lookups are case-insensitive — and `shared/brevo.transport.test.ts` asserts it that way.

The suite applies the rule in both directions. `harness.test.ts` asserts that the database is empty at the start of a test that follows a committed write, so removing the `afterEach` truncation makes it fail. `acceptance.test.ts` asserts a rejected duplicate flag leaves the audit row count unchanged.

## Route coverage

`route-coverage.test.ts` holds the route-level edges and pagination the colocated module suites do not reach:

- flag identity updates through `PATCH` that leave every environment's configuration untouched, and write exactly one `flag.updated` audit row;
- an unknown environment answering 404 rather than an empty config, and an archive refused for a viewer with 403;
- segment rename with replaced conditions, reflected in the list's `conditionCount`, and an unknown segment answering 404;
- cursor paging walked one row at a time across environments, segments and API keys, with a bound so a non-terminating loop cannot hang the suite;
- the compound project create de-duplicating a derived key (`alpha-platform`, then `alpha-platform-2`) while still giving each project its own Development and Production environments;
- environment seeding modes: every flag's configuration written disabled by default, and `initialFlagStatus: "copy-source"` copying the source environment's configurations, with 400 when no source is named;
- audit `from`/`to` range filters, and a workspace metadata value that is not JSON falling back to defaults on `/v1/workspace` and `/v1/workspace/security`.

## Not covered

- The dashboard. `apps/web` defines no `test` script, so `pnpm test` runs nothing against it.
- Metrics and analytics. The app mounts no metrics or analytics route, so there is nothing to test; rollups are a future commitment (`docs/architecture.md §8.2`).
- The evaluation reason `error`. It is in the contract enum, and no test asserts it.
- Coverage reporting. `vitest.config.ts` sets no coverage provider or threshold, and the repository has no CI workflow.

## Related documents

- Full command table and local setup: `docs/development.md`.
- The persistence and audit rules the suites run against: `docs/architecture.md §6`.
- The evaluation semantics unit-tested by `packages/engine/src/engine.test.ts`: `docs/evaluation.md`.
- The authorization rules integration-tested by `project-access.integration.test.ts`: `docs/authorization.md`.

## Status

- Built: 24 test files under `apps/api/src/test/`, the shared harness, the sequential vitest configuration, a per-file database reset and per-test truncation.
- Built: the harness suite, the acceptance suite and the route-coverage suite, all driven through `app.request()` against real PostgreSQL rows.
- Built: pure unit coverage for the evaluation engine and the project-access service.
- Partial: the evaluation engine has one case per reason for six of the eight contract reasons; `flag_not_found` is covered at the route level in `evaluation.test.ts`, and `error` is covered nowhere.
- Partial: `modules/` mixes route-level integration suites with unit suites; the split is by file, not by configuration.
- Not built: any test for `apps/web`; coverage thresholds, coverage reporting or CI.

## Where it lives

- `apps/api/vitest.config.ts` — the include pattern and `fileParallelism: false`.
- `apps/api/src/test/harness.ts` — environment loading, database reset and truncation, sessions and fixtures.
- `apps/api/src/test/harness.test.ts` — coverage for the harness itself.
- `apps/api/src/test/acceptance.test.ts` — end-to-end claims through the app.
- `apps/api/src/test/route-coverage.test.ts` — route-level edges and pagination.
- `apps/api/src/test/modules/` and `apps/api/src/test/shared/` — one suite per API module, and email, templates and the Brevo transport.
- `apps/api/src/config/index.ts` — the module-load validation that fixes the import ordering.
- `apps/api/package.json` and the root `package.json` — the `test` and `check` scripts.
- `docker-compose.yml` — the PostgreSQL instance the default URLs point at.
- `.agents/skills/api/skill.md` — the Tests and Final Verification rules.
