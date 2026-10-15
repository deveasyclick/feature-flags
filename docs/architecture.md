# Iwifunni architecture and commitments

This document is the durable decision record. It states what was decided and why, then
points at the reference document that holds the detail.

**The section numbers are a stable contract.** Source comments cite them as
`docs/architecture.md §N`, so sections are never renumbered and never reused — a new
decision appends a new section. The numbered decision-record identifiers this repository
used to cite in code were retired when this record was split into the documents under
`docs/`.

Implementation rules — layering, validation, testing and comment policy — live in
`AGENTS.md` and `.agents/skills/`. Runbooks and setup live in `docs/development.md`.

---

## 1. System shape

Iwifunni is a pnpm monorepo with three workspaces:

| Workspace            | Responsibility                             |
| -------------------- | ------------------------------------------ |
| `packages/contracts` | Shared Zod schemas and inferred wire types |
| `apps/api`           | Hono API, Drizzle/PostgreSQL, Better Auth  |
| `apps/web`           | Next.js dashboard                          |

The API is a **modular monolith** on Node. Each domain follows
`controller → service → repository`, with supporting `mapper`, `types` and `index` files;
database tables are kept separately under `apps/api/src/db/schema/`; `app.ts` is the only
composition root and the only place an object graph is constructed.

Evaluation runs in one process and reads PostgreSQL directly. Module boundaries are
enforced in code rather than through network boundaries, so a module can be extracted
later without redesigning the application.

→ Module layout, layering rules and the full route inventory: `docs/api-conventions.md`
→ Running the stack: `docs/development.md`

## 2. Tenancy and identity

```text
organization (workspace / tenant)
└── project
    ├── flags
    │   └── variations
    └── environment
        └── flag configuration
```

- Better Auth's organization **is** the workspace/tenant; there is no separate tenant
  table.
- A flag is **project-scoped**: `flags.project_id` is `NOT NULL` and the flag key is unique
  per `(project_id, key)`. What the flag does in one environment is a
  `flag_environment_configs` row, unique per `(flag_id, environment_id)` and written eagerly
  for every environment of the project.
- `project.key` is unique within a workspace, not globally.
- Access outside the caller's tenant or membership scope returns **404**, not 403.
- Environments are archived rather than deleted, and every project retains at least one
  active environment. Projects do not currently support archive or soft-delete.

→ Entities, keys versus ids and per-entity lifecycle: `docs/domain-model.md`
→ Sessions, workspaces and OAuth: `docs/authentication.md`

## 3. Authorization

Workspace roles and project roles are separate vocabularies:

- **workspace** — `owner`, `admin`, `member`
- **project** — `owner`, `admin`, `engineer`, `viewer`

Project roles are ordered and compared by rank. Workspace owners and admins are implicit
project admins. Project membership is resolved from the database on every request, never
from a token claim.

Enforcement:

- Authorization is enforced at the route boundary through the project access gate, and
  every mutating service method asserts the caller's right to act, so a new endpoint cannot
  forget the check.
- Database queries are always scoped by the session's `organizationId`; tenant scope never
  comes from the body, a query parameter or a path segment.
- A cross-tenant read answers **404**, not 403 — a 403 would confirm the resource exists
  and enable enumeration.

Writes to a **protected environment** are refused as direct publishes and become change
requests instead.

→ The full operation-by-role matrix and the gate mechanics: `docs/authorization.md`
→ The approval workflow: `docs/change-requests.md`

## 4. Flags and environments

A flag belongs to the project and carries its identity and its variations; what it does in
one environment is that environment's configuration: an off variation, a default variation,
a rollout percentage and a bucketing attribute, plus that environment's rules and targets.
Targeting rules are ordered and their conditions are AND-ed; individual targets override a
single user; segments are project-scoped and reusable across flags.

An environment changes when its own configuration is published, and the one project-wide
switch is `status`. Flag configuration history is recorded per environment in flag
versions, and archiving — which is project-wide — is the only delete-like operation.

→ Flag anatomy, routes, rules, targeting, versions and dependencies:
`docs/flags.md`
→ Protected environments and approvals: `docs/change-requests.md`

## 5. Evaluation

The evaluation engine is a pure, deterministic function with no I/O, clock, randomness or
cache dependency:

```text
packages/engine/src/evaluate.ts
```

Determinism is the decision: the same input always produces the same variation, so a
rollout is reproducible and the engine is testable one case per evaluation reason.

Percentage bucketing is frozen at a versioned hash over the flag key, a version identifier
and the bucketing value. The identifier makes the algorithm versionable; changing the hash
input or the version reshuffles every user already bucketed and is therefore a
**one-way-door change**.

The evaluation reason vocabulary lives in `packages/contracts`. It includes `error`, which
is not currently produced — evaluation failures reach `app.onError` as generic 500
responses.

At the flag level both endpoints are thresholds: `0%` serves the off variation to everyone and
`100%` serves the default variation to everyone, so the bucket is skipped only at `100%`.
Setting a rollout and enabling a flag are separate decisions, and a flag left enabled at `0%`
serves nobody.

→ Resolution order, the seven reasons the code produces, operator semantics, the exact bucketing input and the
`/v1/evaluate` contract: `docs/evaluation.md`

## 6. Persistence and audit

- Drizzle is the only query surface; tables live one per file under `src/db/schema/` and
  are exported from `src/db/schema/index.ts`. `drizzle.config.ts` points at that barrel, so
  a table missing from it is never migrated.
- Migrations are generated with `drizzle-kit` and committed as plain `.sql`. Generated
  migrations are never hand-edited and are never replaced by pushing a snapshot at shared
  data.
- Repositories take `organizationId` explicitly rather than reading an ambient session, so
  they are testable without a request context.
- An audit row is written **inside** the mutation's transaction, never after commit, so the
  row and the change it describes commit together.
- List endpoints use cursor pagination from the start — `?limit&cursor` →
  `{ data, nextCursor }`.

→ Table inventory, entity lifecycle and the audit event vocabulary:
`docs/domain-model.md`
→ Test database, isolation strategy and expectations: `docs/testing.md`

## 7. The wire contract

`packages/contracts` is the single source of truth for API and domain contracts. Each
domain exposes a Zod schema as a subpath import (`#flag`, `#evaluation`, `#pagination`, …);
both API and web types are inferred from these schemas, and DTOs are never re-declared
elsewhere.

Cross-cutting conventions:

- Every external input is parsed with a `packages/contracts` schema via `safeParse` in the
  controller; `await c.req.json()` is `unknown` until then.
- Failures use the `ApiError` factories and the envelope
  `{ error: { code, message, details? } }`. An unexpected error is logged and returned as a
  generic 500 with no internals.
- URLs use human-readable `key` values; foreign keys use `id`.
- Better Auth's `/api/auth/*` contract is its own and is never wrapped in the envelope.
- All Iwifunni endpoints live under `/v1`.

→ Route inventory, error codes and pagination shape: `docs/api-conventions.md`

## 8. Future commitments

Accepted decisions that are not yet implemented. They are not a speculative roadmap.

### 8.1 Redis configuration cache

**Status: not implemented**

PostgreSQL remains the source of truth. Redis is strictly a cache.

When implemented:

- Cache misses fall back to PostgreSQL.
- Redis failures never fail reads or startup.
- Connections are lazy and reconnect continuously.
- Cache operations use bounded timeouts.
- Snapshots are versioned and TTL-bounded.
- Snapshots are read under `REPEATABLE READ`.
- Writes invalidate before acknowledgement but do not fail if invalidation fails.
- TTL provides eventual self-healing after missed invalidation.
- The client is `redis` (node-redis).
- Redis is not a queue and does not authorize job infrastructure.
- Snapshot shape is `{ version, flags, segments }` to support future local/offline SDK
  evaluation.

`REDIS_URL` is optional and the API starts and serves with Redis unreachable. The local
Redis container deliberately has no volume, so nothing can come to depend on it being
durable.

### 8.2 Analytics rollups

**Status: not implemented**

Analytics will use evaluation events and **PostgreSQL rollups**. Redis is not the analytics
store. No worker or job infrastructure is currently authorized.

Until metrics exist, `Project.status` and `Environment.status` return computed `healthy`
placeholders, and the analytics dashboard is backed by design fixtures rather than data.

### 8.3 Frontend/API origin

The intended production architecture is for the API to be proxied under the web origin:

```text
Browser
   ↓
Web origin
    ├── dashboard
    └── /api → API
```

This makes the Better Auth session cookie first-party. **Today** the dashboard and the API
are separate origins in development: the browser client sends `credentials: "include"`
against the API's origin allowlist, and no Next.js rewrite is in use. A
cross-origin configuration using credentialed CORS and explicit `trustedOrigins` remains
the fallback.

## 9. Open gaps

Known gaps without an accepted implementation decision.

- **Python and Go SDKs** — the TypeScript engine is the reference implementation; the
  conformance corpus in `sdks/fixtures/conformance.json` is what prevents cross-language
  drift, and `@iwifunni/node` is the only SDK built so far.
- **OpenAPI export** — generate `/v1/openapi.json` from the existing Zod contracts. No
  OpenAPI document is served today.
- **Rate limiting**
- **Webhooks**
- **Project archive / soft delete**
