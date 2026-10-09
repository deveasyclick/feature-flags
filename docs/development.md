# Local development

Local setup: stack, environment files, scripts and health endpoints. The dashboard's structure is in
its [README](../apps/web/README.md); decisions are cited from [docs/architecture.md](architecture.md).

## Prerequisites

| Requirement    | Version                  | Declared in                             |
| -------------- | ------------------------ | --------------------------------------- |
| Node.js        | `>=20.9.0`               | `engines.node` in `package.json`        |
| pnpm           | `12.4.1`                 | `packageManager` in `package.json`      |
| PostgreSQL     | image `postgres:17`      | `docker-compose.yml`                    |
| Redis          | image `redis:8`          | `docker-compose.yml`                    |
| Docker Compose | v2 — `docker compose up` | command comment in `docker-compose.yml` |

Install a Node.js satisfying `engines.node` and a pnpm matching `packageManager`; the
versions above are the declared ones.

## The local stack

Start both services with `docker compose up -d`.

| Service  | Image         | Container          | Host port       | Volume                  |
| -------- | ------------- | ------------------ | --------------- | ----------------------- |
| postgres | `postgres:17` | `dariise-postgres` | `5442` → `5432` | `dariise-postgres-data` |
| redis    | `redis:8`     | `dariise-redis`    | `6389` → `6379` | none                    |

The host ports are deliberately non-default: `docker-compose.yml` records that this machine already
runs an unrelated PostgreSQL on 5432/5435 and Redis on 6379/6380, so reusing those would mean sharing
credentials with another project or silently connecting to it.

PostgreSQL mounts the named volume `dariise-postgres-data`; Redis has none — it is cache-only, nothing
there needs to survive a restart, and treating it as durable would invite depending on it, which
[docs/architecture.md](architecture.md) §8.1 rules out.
The credentials (`postgres` / `postgres`, database `dariise`) are development-only and match the
default `DATABASE_URL`.

## Configuration

Each app keeps its environment file beside it, copied from the committed template:

```sh
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

`apps/api/.env`, `apps/web/.env` and `.env*.local` are gitignored. Configuration is read only through
the app's config module, never `process.env` ad hoc:

- **API** — `apps/api/src/config/index.ts` imports `dotenv/config`, then parses `process.env` with
  `ConfigSchema` (`src/config/schema.ts`). A failure throws before anything else runs, listing every
  offending key, so an invalid environment stops the process at startup rather than at first request.
- **Web** — `apps/web/next.config.ts` loads `apps/web/.env` explicitly with `dotenv` before the build
  inlines `NEXT_PUBLIC_*`; `apps/web/shared/env.ts` is the only module in that app that touches
  `process.env`, imported as `import env from "shared/env"`.

The API test harness is the documented exception: `apps/api/src/test/harness.ts` writes `process.env`
before the config module loads ([docs/testing.md](testing.md)).

## Environment variables

**apps/api** — read from `apps/api/src/config/schema.ts`; "required" means the schema rejects a missing
or invalid value and the process exits at startup.

| Variable               | Required | Default                 | What it does                                                                          |
| ---------------------- | -------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `NODE_ENV`             | no       | `development`           | `development`, `test` or `production`; drives `env.environment` and `isProduction`.    |
| `PORT`                 | no       | `4000`                  | Port the HTTP listener binds. The dashboard assumes 4000.                             |
| `DATABASE_URL`         | yes      | —                       | PostgreSQL connection string. Port 5442 matches `docker-compose.yml`.                  |
| `DATABASE_POOL_MAX`    | no       | `10`                    | Maximum PostgreSQL connections this process opens.                                     |
| `REDIS_URL`            | no       | —                       | Redis connection string; an empty value is treated as unset. See §8.1.                 |
| `BETTER_AUTH_SECRET`   | yes      | —                       | Session signing secret; at least 32 characters.                                        |
| `BETTER_AUTH_URL`      | no       | `http://localhost:4000` | Origin the browser reaches the API on. Must match, or cookies are issued for the wrong host. |
| `GITHUB_CLIENT_ID`     | no       | —                       | GitHub OAuth client id.                                                               |
| `GITHUB_CLIENT_SECRET` | no       | —                       | GitHub OAuth client secret.                                                           |
| `GOOGLE_CLIENT_ID`     | no       | —                       | Google OAuth client id.                                                               |
| `GOOGLE_CLIENT_SECRET` | no       | —                       | Google OAuth client secret.                                                           |
| `BREVO_API_KEY`        | yes      | —                       | Brevo transactional email key; trimmed, at least 5 characters.                         |
| `EMAIL_FROM`           | yes      | —                       | Sender address for verification and reset mail; must be an email address.              |
| `EMAIL_SENDER_NAME`    | no       | `Dariise`               | Sender name a recipient sees.                                                          |

Validated at startup: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BREVO_API_KEY`, `EMAIL_FROM`.

A provider needs **both** of its values: `enabledProviders` in `apps/api/src/shared/constants.ts`
enables one only when the id and secret are set, and `src/modules/auth/auth.config.ts` omits a
half-configured provider from `socialProviders`, treating it as absent rather than trusted. Provider
setup belongs to [docs/authentication.md](authentication.md).

`REDIS_URL` is optional: the API starts and serves with Redis unreachable. The cache contract is
[docs/architecture.md](architecture.md) §8.1.

**apps/web** — read from `apps/web/shared/env.ts`.

| Variable              | Required               | Default                 | What it does                                                                       |
| --------------------- | ---------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `NODE_ENV`            | no                     | `development`           | `production` and `test` are recognised; anything else resolves to `development`.    |
| `NEXT_PUBLIC_API_URL` | production builds only | `http://localhost:4000` | API base URL as reached from the browser; production throws when missing, trailing slashes stripped. |
| `API_INTERNAL_URL`    | no                     | `http://localhost:4000` | Server-only base URL Server Components call without a round trip through the public origin. |

Only `NEXT_PUBLIC_`-prefixed variables reach the browser; `API_INTERNAL_URL` is server-only.

## Migrations and the schema workflow

- `pnpm db:generate` runs `drizzle-kit generate` in `apps/api`: it reads the schema barrel and writes
  SQL into `apps/api/drizzle` (`out` in `drizzle.config.ts`). Commit the generated `.sql`.
- `pnpm db:migrate` runs `drizzle-kit migrate` to apply committed migrations. Never hand-edit a
  generated migration; change the schema module and regenerate.
- `drizzle.config.ts` points `schema` at `./src/db/schema/index.ts`, the barrel. A new table **must** be
  exported from that barrel, or it is never migrated.
- `pnpm db:push` runs `drizzle-kit push`, applying the schema straight to a database without migration
  files. Local databases only — never against shared data.
- `pnpm --filter api auth:generate` writes `src/db/auth-schema.generated.ts` (gitignored) from
  `src/modules/auth/auth.cli.ts`, diffing Better Auth's expected tables against the hand-written ones.

Today `apps/api/drizzle` does not exist and no generated SQL is committed: the schema is applied with
`drizzle-kit push`, not replayed migrations ([docs/testing.md](testing.md)). `pnpm db:migrate`
therefore exits non-zero — it has no migration directory to apply — and `pnpm db:push` is the command
that actually builds the schema.

## Commands

Run these from the repository root; the root scripts recurse across the workspace.

| Command            | Runs                                    | What it does                                                                                     |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm dev`         | `pnpm --parallel --recursive dev`       | Starts both dev servers: `next dev` (web) and `tsx watch src/server.ts` (api).                    |
| `pnpm dev:web`     | `pnpm --filter web dev`                 | Dashboard only.                                                                                   |
| `pnpm dev:api`     | `pnpm --filter api dev`                 | API only.                                                                                         |
| `pnpm build`       | `pnpm --recursive build`                | Builds **both** apps: `tsc --project tsconfig.build.json` plus the email-template copy in `apps/api`, and `next build` in `apps/web`. |
| `pnpm start`       | `pnpm --filter web start`               | Serves the web production build (`next start`). The API entry is `pnpm --filter api start` (`node dist/server.js`), after a build. |
| `pnpm lint`        | `pnpm --recursive lint`                 | Runs **both** linters: biome in `apps/api` and eslint in `apps/web`.                              |
| `pnpm typecheck`   | `pnpm --recursive typecheck`            | `tsc --noEmit` in `packages/contracts`, `apps/api` and `apps/web`.                                |
| `pnpm test`        | `pnpm --recursive test`                 | `vitest run` in `apps/api`; no other workspace declares a test script.                             |
| `pnpm check`       | `typecheck && lint && test` recursively | The gate a change must pass.                                                                      |
| `pnpm db:generate` | `pnpm --filter api db:generate`         | `drizzle-kit generate`.                                                                           |
| `pnpm db:push`     | `pnpm --filter api db:push`             | `drizzle-kit push`; local databases only.                                                         |
| `pnpm db:migrate`  | `pnpm --filter api db:migrate`          | `drizzle-kit migrate`.                                                                            |

`pnpm check` combines `typecheck`, `lint` and `test` across every workspace that defines them, and must
exit 0 before hand-off. Scope any script with `--filter` (e.g. `pnpm --filter api test`);
`pnpm --filter api format` and `auth:generate` have no root alias.

## Local URLs and operational endpoints

| Surface   | URL                     | Served by                      |
| --------- | ----------------------- | ------------------------------ |
| Dashboard | `http://localhost:3000` | `next dev` / `next start`      |
| API       | `http://localhost:4000` | `@hono/node-server`, on `PORT` |

`/healthz` is a liveness check and touches no dependency; `/readyz` runs a `select 1` database check,
records Redis as `not_configured`, and is ready only when that check succeeds:

```text
GET /healthz  200 { "status": "ok" }
GET /readyz   200 { "status": "ready",   "checks": { "database": "ok",    "redis": "not_configured" } }
GET /readyz   503 { "status": "unready", "checks": { "database": "error", "redis": "not_configured" } }
```

Neither is behind session middleware: they and `/api/auth/*` form the unauthenticated surface.

## Logging and lifecycle

`apps/api/src/app.ts` applies global middleware in this order:

1. `secureHeaders()` on every route.
2. `logger()` — Hono's request logger.
3. CORS, built per request: `origin` returns the request origin only when it is in the allowlist
   literal in `app.ts`, with `credentials: true`, allowed headers `Content-Type` and
   `Authorization`, methods `GET`, `POST`, `PATCH`, `PUT`, `DELETE`, `OPTIONS`, and `maxAge` 600.
   Entries must be bare origins. A browser's `Origin` header carries no trailing slash, and both
   Hono and Better Auth compare it as an exact string, so an entry ending in `/` matches nothing
   and silently fails every preflight.

Logging today is Hono's request logger plus direct `console` output: `console.info` on startup, and
`console.warn` on a repeated shutdown signal. `pino` is declared as a dependency of `apps/api`, but
nothing under `apps/api/src` imports it, so there is no structured application logger yet.

`src/server.ts` installs `SIGTERM` and `SIGINT` handlers. The first signal stops accepting connections
and awaits `server.close()` so in-flight requests finish, then drains the pool and exits 0; the listener
closes first deliberately. A second signal logs and exits 1 immediately.

## The database pool

`apps/api/src/db/client.ts` builds one `pg.Pool` sized by `DATABASE_POOL_MAX` (default `10`). The rule
recorded in `apps/api/.env.example`: keep `instances × DATABASE_POOL_MAX` below `max_connections`.

## What is not built

- Three dashboard surfaces are fixtures rather than API data: analytics, billing and SDK install snippets
  ([apps/web/README.md](../apps/web/README.md) lists these and the disabled controls).
- The API has no metrics endpoint, no billing endpoint, no segment-membership endpoint, no `GET` for
  preferences or notifications, and no project archive ([docs/architecture.md](architecture.md) §9).

## Status

- **Exists** — the Compose stack; committed `.env.example` templates; startup-validated API
  configuration; the web env loader; `/healthz` and `/readyz`; graceful shutdown; the command surface.
- **Partial** — Redis is configurable but off the critical path (`/readyz` reports `not_configured`);
  no migration directory is committed, so the schema is applied with `drizzle-kit push`; `pino` is
  installed but unused; `packages/contracts` has only `typecheck` and `apps/web` no test script.
- **Not built** — no metrics, billing, segment-membership, preferences, notifications or
  project-archive endpoints ([docs/architecture.md](architecture.md) §9).

## Where it lives

- `docker-compose.yml` — the local PostgreSQL and Redis services and their ports.
- `package.json` — root scripts, `engines.node`, `packageManager`.
- `pnpm-workspace.yaml` — workspace globs and the build-script allowlist.
- `apps/api/package.json` — API scripts, including `dev`, `build`, `start`, `db:*`.
- `apps/web/package.json` — dashboard scripts.
- `packages/contracts/package.json` — shared-schema package; `typecheck` only.
- `apps/api/.env.example` — committed API environment template.
- `apps/web/.env.example` — committed dashboard environment template.
- `apps/api/src/config/index.ts` — loads `.env` and validates it at startup.
- `apps/api/src/config/schema.ts` — the zod schema and defaults.
- `apps/web/next.config.ts` — loads `apps/web/.env` before the build.
- `apps/web/shared/env.ts` — the dashboard's only config reader.
- `apps/api/src/server.ts` — listener, startup log and shutdown sequence.
- `apps/api/src/app.ts` — global middleware, `/healthz`, `/readyz`, error handling.
- `apps/api/src/db/client.ts` — the connection pool and `closeDatabase`.
- `apps/api/drizzle.config.ts` — drizzle-kit schema barrel and output directory.
- `apps/api/vitest.config.ts` — test runner configuration and its prerequisites.
- `.gitignore` — ignored env files and generated artifacts.
- `apps/web/README.md` — dashboard routes, components and fixture-backed screens.
- `docs/architecture.md` — the decision record this page cites by section number.
