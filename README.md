# Iwifunni

> Feature management and progressive delivery for modern applications.

Iwifunni is a developer-focused feature management platform for safely controlling
application features without requiring a new deployment.

It lets teams create feature flags, manage them across environments, target specific users,
gradually roll out features, and track configuration changes from a central dashboard.

---

## How It Fits Together

A project owns its environments, flags and segments. A flag belongs to the project and
carries the variations that every environment selects among. What the flag does in one
environment — whether it is enabled, its off and default variation, its rollout — is its
configuration, one row per flag and environment, and the targeting rules and individual
targets hang off that. Targeting reaches the project's segments by key.

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

The full tree, all of its tables and the per-entity lifecycle are in
[`docs/domain-model.md`](docs/domain-model.md); a flag's anatomy is
[`docs/flags.md`](docs/flags.md).

---

## Overview

- [How It Fits Together](#how-it-fits-together)
- [Features](#features)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

- Feature flag management — create, configure, archive and target flags
- Multiple environments per project, with archive and restore
- Project-scoped flags: a flag key is unique within its project, with a configuration per environment
- User-based targeting and per-user individual targets
- Percentage-based rollouts with deterministic bucketing
- Reusable, project-scoped user segments
- Flag configuration history and dependency reads
- Protected environments with change-request approvals
- Audit log of every configuration change
- Workspace and project role-based access control
- API key management for environment credentials
- Flag evaluation API
- PostgreSQL-backed configuration

## How It Works

Feature flags make it possible to separate **deploying code** from **releasing
functionality**.

Instead of:

```text
Build → Deploy → Everyone gets the feature
```

Iwifunni enables:

```text
Build → Deploy → Gradually release
                    │
                    ├── Internal users
                    ├── Beta users
                    ├── 10%
                    ├── 50%
                    └── 100%
```

This makes it easier to release features safely, test changes with smaller groups of users,
and quickly disable functionality without deploying new code.

---

## Architecture

Iwifunni is a pnpm monorepo: a Next.js dashboard, a Hono API, and a shared contract package
that both depend on.

```text
                         ┌──────────────────────┐
                         │       Next.js        │
                         │      Dashboard       │
                         └──────────┬───────────┘
                                    │
                              HTTP / SSE
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │  Hono 4 on Node.js   │
                         │   modular monolith   │
                         │                      │
                         │  Projects            │
                         │  Environments        │
                         │  Feature Flags       │
                         │  Targeting           │
                         │  Rollouts            │
                         │  Segments            │
                         │  Audit Logs          │
                         └───────┬───────┬──────┘
                                 │       │
                         ┌───────▼───┐ ┌─▼──────┐
                         │ PostgreSQL│ │ Redis  │
                         └───────────┘ └────────┘
```

PostgreSQL is the source of truth. Redis is planned as a configuration cache only, is never
on the critical path, and is not wired up yet — see
[`docs/architecture.md §8.1`](docs/architecture.md).

Each API domain follows `controller → service → repository`, with `app.ts` as the single
composition root; database tables live outside the modules so the schema barrel can reach
them all. The dashboard is an App Router application that reads and writes through one
typed client over the shared contracts.

---

## Tech Stack

### Frontend

- Next.js
- TypeScript
- Tailwind CSS v4
- shadcn/ui

### Backend

- Node.js
- TypeScript
- Hono 4
- Drizzle ORM
- Better Auth

### Data

- PostgreSQL — the source of truth
- Redis — intended as a configuration cache only, never on the critical path

### Testing

- Vitest
- API integration tests

### Infrastructure

- Docker
- Docker Compose

---

## Project Structure

```text
iwifunni/
│
├── apps/
│   ├── web/                      # Next.js dashboard
│   │   ├── app/
│   │   │   ├── (auth)/           # sign in, sign up, reset, create workspace
│   │   │   ├── (getting-started)/# create project (last onboarding step)
│   │   │   ├── (app)/            # overview, projects, flags, segments,
│   │   │   │                     # environments, api keys, sdks, analytics,
│   │   │   │                     # audit log, settings, profile
│   │   │   ├── layout.tsx
│   │   │   ├── not-found.tsx
│   │   │   └── globals.css       # design tokens
│   │   ├── components/
│   │   │   ├── app/              # sidebar, topbar, switchers, tables, cards
│   │   │   │                     # + flags/, projects/, segments/,
│   │   │   │                     #   environments/, api-keys/, analytics/,
│   │   │   │                     #   audit-log/, sdks/, settings/, profile/
│   │   │   ├── auth/             # auth shell, step path, shared fields, forms
│   │   │   ├── ui/               # shadcn/ui primitives
│   │   │   └── logo.tsx
│   │   ├── lib/                  # api client, auth actions, scope, formatters,
│   │   │                         # and the three fixture modules
│   │   ├── shared/env.ts         # the app's only process.env reader
│   │   ├── proxy.ts              # request gate for signed-in routes
│   │   ├── next.config.ts        # loads .env before NEXT_PUBLIC_* is inlined
│   │   └── public/
│   │
│   └── api/                      # Hono API
│       ├── src/
│       │   ├── app.ts            # composition root, middleware, error boundary
│       │   ├── server.ts         # process entry point and graceful shutdown
│       │   ├── config/           # zod-validated environment
│       │   ├── db/               # client, audit helper, schema/ (one file per table)
│       │   ├── integrations/     # third-party adapters (brevo)
│       │   ├── middleware/       # session resolution and workspace gates
│       │   ├── modules/          # account, api-keys, audit-log, auth,
│       │   │                     # change-requests, email, environments,
│       │   │                     # evaluation, flags, project-access,
│       │   │                     # project-members, projects, segments, workspace
│       │   ├── shared/           # constants, http/errors, pagination, types
│       │   └── test/             # harness + suites (modules/, shared/)
│       └── drizzle.config.ts     # points at src/db/schema/index.ts
│
├── packages/
│   └── contracts/                # zod schemas + inferred types shared with apps/web
│
├── docs/                         # architecture and reference documentation
│
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

---

## Getting Started

### Prerequisites

Make sure you have:

- Node.js 20.9+ (the root `engines` requirement)
- pnpm 12 (pinned by `packageManager`)
- Docker

PostgreSQL 17 and Redis 8 are provided by Docker Compose, so they do not need to be
installed locally.

### Clone the repository

```bash
# The repository keeps its original name; the directory it creates is not the
# project name.
git clone https://github.com/deveasyclick/feature-flags.git

cd feature-flags
```

### Start infrastructure

```bash
docker compose up -d postgres redis
```

PostgreSQL is published on host port **5442** and Redis on **6389**, not their defaults —
this avoids colliding with an unrelated stack already using 5432/6379.

### Install dependencies

`apps/web`, `apps/api` and `packages/contracts` are workspaces of one pnpm project, so
dependencies are installed once from the repository root:

```bash
pnpm install
```

### Backend

Create your environment file:

```bash
cp apps/api/.env.example apps/api/.env
```

Fill in `BETTER_AUTH_SECRET` (at least 32 characters — `openssl rand -base64 32`) plus the
Brevo values, then apply the schema and start the API:

```bash
pnpm --filter api db:push
pnpm --filter api dev
```

`db:push` applies the schema straight to a local database. No generated migrations are
committed yet, so `db:migrate` currently has nothing to replay — the workflow is described
in [`docs/development.md`](docs/development.md).

The API is then available at:

```text
http://localhost:4000
```

### Frontend

Create your environment file:

```bash
cp apps/web/.env.example apps/web/.env
```

Start the dev server:

```bash
pnpm dev
```

The dashboard is available at:

```text
http://localhost:3000
```

### Workspace commands

Run from the repository root. Most commands fan out across the workspaces; the
`--filter` escape hatch scopes one.

| Command           | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `pnpm dev`        | Run the dashboard and the API together                              |
| `pnpm dev:web`    | Dashboard only                                                      |
| `pnpm dev:api`    | API only                                                            |
| `pnpm build`      | Production build of both apps                                       |
| `pnpm start`      | Serve the built dashboard (`apps/web` only)                         |
| `pnpm lint`       | Biome (API) and ESLint (dashboard)                                  |
| `pnpm typecheck`  | `tsc --noEmit` across contracts, API and dashboard                  |
| `pnpm test`       | API tests (`apps/web` has no test suite)                            |
| `pnpm check`      | `typecheck` + `lint` + `test` — the gate a change must pass         |
| `pnpm db:generate`| Generate a Drizzle migration from the schema barrel                 |
| `pnpm db:push`    | Push the schema straight to a database (local use only)             |
| `pnpm db:migrate` | Apply committed migrations to a database |

Any of these can be scoped to one workspace with `pnpm --filter <web\|api> <script>`.

---

## Environment Variables

Each app keeps its environment file beside it. The files are not committed;
`apps/api/.env.example` and `apps/web/.env.example` are the templates to copy. Configuration
is read through the app's config module — `apps/api/src/config/index.ts` or
`apps/web/shared/env.ts` — never `process.env` directly.

### `apps/api/.env`

| Variable             | Required | Default                 | Purpose                                                                |
| -------------------- | -------- | ----------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`       | Yes      | —                       | PostgreSQL connection string                                           |
| `BETTER_AUTH_SECRET` | Yes      | —                       | Session signing secret; at least 32 characters                         |
| `BREVO_API_KEY`      | Yes      | —                       | Transactional email for verification and reset codes                   |
| `EMAIL_FROM`         | Yes      | —                       | Sender address; must be verified in your Brevo account                  |
| `BETTER_AUTH_URL`    | No       | `http://localhost:4000` | The origin the browser reaches the API on                              |
| `PORT`               | No       | `4000`                  | API listen port                                                        |
| `NODE_ENV`           | No       | `development`           | `development`, `test` or `production`                                  |
| `DATABASE_POOL_MAX`  | No       | `10`                    | Max connections this process opens; keep instances × this below the server's limit |
| `REDIS_URL`          | No       | —                       | Configuration cache only; the API starts and serves with Redis unreachable |
| `EMAIL_SENDER_NAME`  | No       | `Iwifunni`               | Sender name shown in the recipient's inbox                             |
| `GITHUB_CLIENT_ID`   | No       | —                       | GitHub sign-in; needs both GitHub values or the provider is disabled  |
| `GITHUB_CLIENT_SECRET`| No      | —                       | GitHub sign-in                                                         |
| `GOOGLE_CLIENT_ID`   | No       | —                       | Google sign-in; needs both Google values or the provider is disabled  |
| `GOOGLE_CLIENT_SECRET`| No      | —                       | Google sign-in                                                         |

Required values are validated at startup: a missing one fails immediately rather than on the
first request that needs it. The registered redirect URIs for social sign-in are
`http://localhost:4000/api/auth/callback/github` and `.../google`; GitHub needs the
`user:email` scope.

### `apps/web/.env`

| Variable              | Required | Default                 | Purpose                                                                 |
| --------------------- | -------- | ----------------------- | ----------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | Yes      | `http://localhost:4000` | Base URL of the API as reached from the browser. No trailing slash      |
| `API_INTERNAL_URL`    | No       | Value of the above      | Server-only; used by Server Components so they skip the public origin    |

Only variables prefixed with `NEXT_PUBLIC_` are exposed to the browser.

---

## Documentation

The durable reference lives in [`docs/`](docs/README.md).

| Document | Covers |
| --- | --- |
| [`architecture.md`](docs/architecture.md) | The decision record: system shape, tenancy, authorization, evaluation, persistence, the wire contract, future commitments and open gaps |
| [`domain-model.md`](docs/domain-model.md) | Entities, keys versus ids, lifecycle, tables and audit events |
| [`authorization.md`](docs/authorization.md) | Roles, the operation matrix and tenant isolation |
| [`flags.md`](docs/flags.md) | Flag anatomy, targeting, rollout, versions and dependencies |
| [`change-requests.md`](docs/change-requests.md) | Protected environments and the approval workflow |
| [`evaluation.md`](docs/evaluation.md) | Resolution order, reasons, operators, bucketing and `/v1/evaluate` |
| [`api-conventions.md`](docs/api-conventions.md) | Contracts, routes, errors, pagination and versioning |
| [`authentication.md`](docs/authentication.md) | Sessions, workspaces, email codes, OAuth and API keys |
| [`testing.md`](docs/testing.md) | Test suite, database and expectations |
| [`development.md`](docs/development.md) | Setup, configuration, migrations and operations |

Every document ends with a `Status` section, so what is implemented, what is partial and what
is not built is stated next to the subject rather than collected in one place.

Each app also keeps its own document: [`apps/api/README.md`](apps/api/README.md) for
the API's modules, layering and test suite, and [`apps/web/README.md`](apps/web/README.md)
for the dashboard's routes, components and design tokens.

---

## Roadmap

Feature flag evaluation sits in the critical path of application behaviour, so the platform
is built outward from a correct, auditable core. What exists today is recorded per subject
in the `Status` section of each [document](#documentation); this is what remains.

### Feature management

- [ ] User attribute definitions
- [ ] Scheduled rollouts
- [ ] Rollout history and automatic rollback
- [ ] Change notifications

### SDKs and delivery

- [ ] JavaScript/TypeScript SDK
- [ ] Python SDK
- [ ] Go SDK
- [x] Node.js local configuration caching and offline evaluation
- [x] Node.js fallback values and safe defaults
- [x] Node.js configuration polling
- [ ] Real-time updates

### Caching and scale

- [ ] Redis configuration cache — see [`architecture.md §8.1`](docs/architecture.md)
- [ ] Analytics rollups — see [`architecture.md §8.2`](docs/architecture.md)

### Observability

- [ ] Flag evaluation metrics
- [ ] Evaluation latency
- [ ] Error tracking
- [ ] Usage analytics
- [ ] OpenTelemetry integration

### Platform

- [ ] SDK authentication for `/v1/evaluate`
- [ ] OpenAPI export
- [ ] Rate limiting
- [ ] Webhooks
- [ ] Project archive / soft delete

### Dashboard surfaces without an endpoint

- [ ] Workspace integrations, billing and workspace theme
- [ ] API key rename and rotation
- [ ] Segment membership

---

## License

MIT
