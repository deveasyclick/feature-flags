# API conventions

Dariise's HTTP surface is versioned, schema-first and uniformly shaped: a route lives under `/v1`, parses a
`packages/contracts` schema, calls one service method, and fails through one error envelope. Decisions:
`docs/architecture.md §7`; role matrix: `docs/authorization.md`.

## The contract package

`packages/contracts` is the single source of truth for the wire contract: each domain ships a `zod` schema and
its TypeScript type is inferred with `z.infer`, never restated in `apps/api` or `apps/web`.

Its `imports` map exposes twenty-one subpaths, each resolving to `./src/<name>.ts`: `#api-key`, `#audit-log`,
`#auth`, `#change-request`, `#environment`, `#errors`, `#evaluation`, `#fields`, `#flag`, `#forms`, `#me`,
`#oauth`, `#pagination`, `#project`, `#project-member`, `#query`, `#sdk`, `#segment`, `#session`, `#slug`,
`#workspace`.

The `exports` map publishes only the root entry, `.` → `./src/index.ts`, which re-exports every subpath.
Consumers import `@dariise/contracts`; a `#name` specifier resolves only inside the package, where one contract
file imports another (`flag.ts` uses `#environment`, `#pagination`, `#slug`).

## Module layout and layering

Each domain is one directory under `apps/api/src/modules/`:

```text
<name>.routes.ts       router factory; owns every path below its mount
<name>.controller.ts   HTTP wiring and input parsing
<name>.service.ts      business rules, authorization, transactions
<name>.repository.ts   the only place Drizzle tables are queried
<name>.mapper.ts · <name>.types.ts · <name>.index.ts   row → DTO · exported types · public surface
```

The layering is one-directional: `controller → service → repository`; nothing skips a layer and nothing goes
backward.

- The controller does HTTP only: it validates the request, calls one service method and returns its result.
- The service holds the rules; every mutating method asserts the caller's right to act, and transactions live here.
- The repository is the only file that imports and queries Drizzle tables, takes `organizationId` explicitly, and returns rows for a mapper.

A module reaches another module through its `index.ts` only. `app.ts` is the sole composition point: it builds
the graph in dependency order (repositories → services → controllers → routers), mounts the routers and owns
the error boundary. Cross-module needs are injected there — the flags service gets a segment-key validator, the
environments service a flag configuration copier, the projects service a default-environment creator, and the change-requests
service the flags module's validate/apply pair.

Shared types and constants live in `src/shared/types/` and `src/shared/constants.ts`; session middleware and
gates in `src/middleware/authorization.ts`; the Drizzle client, schema and audit writer in `src/db/`. Auth adds
`auth.config.ts` and `auth.cli.ts`; evaluation is the pure function in `packages/engine/src/`, described in
`docs/architecture.md §5`.

## Route inventory

A routes file exports a `create<Name>Routes(deps)` factory that receives its controller and middleware; it never constructs a class. Routers mounted at `/v1/projects` own the paths below that prefix; routers mounted at
`/` spell out their `/v1` paths. Every router applies the session middleware to all of its paths except the auth router, which applies it to `/v1/me` alone; `/healthz` and `/readyz` are registered on the app before any
module router. Below, `…` stands for `/v1/projects/:projectKey/flags/:flagKey`.

| Mount | Method | Path | Purpose |
| --- | --- | --- | --- |
| `/` | GET | `/healthz` | Liveness; `{ status: "ok" }`, no database access. |
| `/` | GET | `/readyz` | Readiness; `select 1` against PostgreSQL, 200 with `{ status, checks }` or 503. |
| `/` | ALL | `/api/auth/*` | Better Auth's handler, given the raw request; no session middleware. |
| `/` | GET | `/v1/auth/providers` | OAuth providers enabled for this deployment; public, no session middleware. |
| `/` | GET | `/v1/me` | The caller's user, workspace, `hasProject` flag and enabled providers. |
| `/` | PATCH | `/v1/me` | Update the caller's profile. |
| `/` | POST | `/v1/me/password` | Change the password; `{ status: "ok" }`. |
| `/` | PATCH | `/v1/me/preferences` | Update per-user, workspace-scoped preferences. |
| `/` | PATCH | `/v1/me/notifications` | Update notification settings. |
| `/` | GET | `/v1/workspace` | Read the session's workspace profile. |
| `/` | PATCH | `/v1/workspace` | Update the workspace profile. |
| `/` | GET | `/v1/workspace/security` | Read the workspace's security settings. |
| `/` | PATCH | `/v1/workspace/security` | Update the workspace's security settings. |
| `/` | POST | `/v1/evaluate` | Evaluate one flag; semantics in `docs/evaluation.md`. |
| `/` | GET | `/v1/audit-logs` | Workspace-wide audit page. |
| `/` | GET | `/v1/projects/:projectKey/audit-logs` | Project-scoped audit page. |
| `/` | GET | `/v1/flags` | Workspace-wide flag list; optional `projectKey`, `environmentKey`, `status`, `search` filters. |
| `/` | GET | `/v1/flags/:flagKey` | Resolve a flag; requires the `projectKey` query parameter, `environmentKey` is optional. |
| `/` | GET | `/v1/projects/:projectKey/flags` | List the project's flags; optional `environmentKey` filter. |
| `/` | POST | `/v1/projects/:projectKey/flags` | Create a flag; the body names no environment; 201. |
| `/` | GET | `/v1/projects/:projectKey/flags/:flagKey` | Read the flag: identity, per-environment summaries and variations. |
| `/` | PATCH | `/v1/projects/:projectKey/flags/:flagKey` | Update the flag's identity. |
| `/` | DELETE | `/v1/projects/:projectKey/flags/:flagKey` | Archive the flag in every environment. |
| `/` | POST | `/v1/projects/:projectKey/flags/:flagKey/unarchive` | Restore an archived flag. |
| `/` | GET | `…/variations` | Read the flag's variations. |
| `/` | POST | `…/variations` | Add a variation; 201. |
| `/` | PATCH | `…/variations/:variationKey` | Edit a variation's name, value or description; the key is immutable. |
| `/` | DELETE | `…/variations/:variationKey` | Remove a variation; 409 while an environment references it. |
| `/` | GET | `…/environments/:environmentKey` | Read that environment's configuration. |
| `/` | PATCH | `…/environments/:environmentKey` | Publish that environment's configuration; no variations. |
| `/` | GET | `…/environments/:environmentKey/rules` | Read the targeting rules. |
| `/` | PUT | `…/environments/:environmentKey/rules` | Replace the targeting rules. |
| `/` | GET | `…/environments/:environmentKey/targets` | Read the individual targets. |
| `/` | PUT | `…/environments/:environmentKey/targets` | Replace the individual targets. |
| `/` | PUT | `…/environments/:environmentKey/targeting` | Publish the rules, the individual targets and the configuration together, in one transaction and one version. |
| `/` | GET | `…/environments/:environmentKey/versions` | That environment's configuration history; paginated. |
| `/` | GET | `…/dependencies` | Read the flag's dependencies. |
| `/v1/projects` | GET | `/v1/projects` | List projects; the only filter is `search`. |
| `/v1/projects` | POST | `/v1/projects` | Create a project with its Development and Production environments and owner membership; 201. |
| `/v1/projects` | GET | `/v1/projects/:projectKey` | Read one project. |
| `/v1/projects` | PATCH | `/v1/projects/:projectKey` | Update the project. |
| `/v1/projects` | GET | `/v1/projects/:projectKey/environments` | List environments; paginated, with `includeArchived`. |
| `/v1/projects` | POST | `/v1/projects/:projectKey/environments` | Create an environment; 201. |
| `/v1/projects` | GET | `/v1/projects/:projectKey/environments/:environmentKey` | Read one environment. |
| `/v1/projects` | PATCH | `/v1/projects/:projectKey/environments/:environmentKey` | Update the environment. |
| `/v1/projects` | PATCH | `/v1/projects/:projectKey/environments/:environmentKey/settings` | Set whether the environment is protected. |
| `/v1/projects` | POST | `/v1/projects/:projectKey/environments/:environmentKey/archive` | Archive the environment. |
| `/v1/projects` | POST | `/v1/projects/:projectKey/environments/:environmentKey/unarchive` | Unarchive the environment. |
| `/v1/projects` | GET | `/v1/projects/:projectKey/segments` | List segments; paginated, with `search` and `includeArchived`. |
| `/v1/projects` | POST | `/v1/projects/:projectKey/segments` | Create a segment; 201. |
| `/v1/projects` | GET | `/v1/projects/:projectKey/segments/:segmentKey/flags` | List the flags that reference the segment. |
| `/v1/projects` | GET | `/v1/projects/:projectKey/segments/:segmentKey` | Read one segment. |
| `/v1/projects` | PATCH | `/v1/projects/:projectKey/segments/:segmentKey` | Update the segment. |
| `/v1/projects` | DELETE | `/v1/projects/:projectKey/segments/:segmentKey` | Archive the segment. |
| `/v1/projects` | GET | `/v1/projects/:projectKey/api-keys` | List API keys; paginated, with `includeRevoked` and `environmentKey` (which also keeps the project-wide keys). |
| `/` | GET | `/v1/sdk/config` | One environment's SDK configuration snapshot, authenticated by an `Authorization: Bearer <sdkKey>` runtime key; `ETag` and `304`. |
| `/v1/projects` | POST | `/v1/projects/:projectKey/api-keys` | Create an API key; 201. |
| `/v1/projects` | DELETE | `/v1/projects/:projectKey/api-keys/:keyId` | Revoke an API key by its row id. |
| `/v1/projects` | GET | `/v1/projects/:projectKey/members` | List the project's members; every member, unpaginated. |
| `/v1/projects` | POST | `/v1/projects/:projectKey/members` | Add a member; 201. |
| `/v1/projects` | PATCH | `/v1/projects/:projectKey/members/:userId` | Change a member's role. |
| `/v1/projects` | DELETE | `/v1/projects/:projectKey/members/:userId` | Remove a member. |
| `/v1/projects` | GET | `/v1/projects/:projectKey/flags/:flagKey/change-requests` | List the flag's change requests; paginated. |
| `/v1/projects` | POST | `/v1/projects/:projectKey/flags/:flagKey/change-requests` | Propose a change; 201. See `docs/change-requests.md`. |
| `/v1/projects` | POST | `/v1/projects/:projectKey/flags/:flagKey/change-requests/:requestId/approve` | Approve and apply the change. |
| `/v1/projects` | POST | `/v1/projects/:projectKey/flags/:flagKey/change-requests/:requestId/reject` | Reject the change. |

## The error contract

Every Dariise failure is rendered by `errorResponse`, the single handler passed to `app.onError`. A thrown
`ApiError` becomes `{ error: { code, message, details? } }`; `details` appears only when the factory was given one.

| Factory | Status | Code value | Details |
| --- | --- | --- | --- |
| `badRequest(message, details?)` | 400 | `invalid_request` | optional |
| `unauthorized(message?)` | 401 | `unauthorized` | — |
| `forbidden(message)` | 403 | `forbidden` | — |
| `notFound(message)` | 404 | `not_found` | — |
| `conflict(message, details?)` | 409 | `conflict` | optional |
| `approvalRequired(environmentKey)` | 409 | `approval_required` | `{ environmentKey }` |

`ERROR_CODE` is the vocabulary; `internal_error` is the seventh value, with no factory because it is the fallback.
`approvalRequired` exists for a client with a next step: a direct publish to a protected environment is refused, and `details` names the environment so the dashboard can offer the change-request flow (`docs/change-requests.md`).

Any other thrown error is logged and returned as a generic 500 with code `internal_error` and no message, stack or internals. An unmatched path is rendered by `app.notFound` in the same shape, with literal code `not_found`
and message `No route for <path>.`; it is built inline rather than through a factory. The client schema is `apiErrorSchema` in `packages/contracts/src/errors.ts`.

## Better Auth's exception

`/api/auth/*` is registered with `routes.all` and forwards the raw request to `auth.handler`, so Better Auth renders its own responses. It is mounted at `/`, away from `/v1`, so its handler can never shadow a versioned router.
Its error contract is its own and is never wrapped in the `ApiError` envelope. Sessions and credentials are in `docs/authentication.md`.

## Cursor pagination

List endpoints take `?limit&cursor` and answer `{ data, nextCursor }`. `paginationQuerySchema` makes `limit` a
coerced integer, minimum 1, maximum `MAX_PAGE_SIZE` (100), defaulting to `DEFAULT_PAGE_SIZE` (50), and `cursor`
an optional string; the response shape is `Page<T>`, `{ data: T[]; nextCursor: string | null }`.

`encodeCursor` and `decodeCursor` use base64url, keeping the cursor opaque so a caller cannot depend on the ordering column. `toPage(rows, limit, cursorOf)` expects a query that fetched `limit + 1` rows: the extra row signals
another page, so no count query is issued, and the last page reports `nextCursor: null`. `paginatedSchema(item)` builds the matching contract schema. The list endpoints that paginate are environments, segments, API keys,
both flag lists, flag versions, change requests and audit logs.

## Naming and addressing

- Paths are plural and resource-oriented: `/projects`, `/environments`, `/flags`, `/segments`, `/api-keys`, `/change-requests`, `/audit-logs`.
- A named resource is addressed by its `key` in the URL (`:projectKey`, `:environmentKey`, `:flagKey`, `:segmentKey`);
  a foreign key is addressed by an id (`:userId` for a member, `:keyId` for an API key row). The rule is `key` in the URL, `id` for a foreign key.
- Keys are unique per parent, never globally, so the path carries the parent: `project.key` is unique within a workspace
  (`docs/architecture.md §2`), and a flag key is unique within a project, which is why the canonical flag path is `/v1/projects/:projectKey/flags/:flagKey`.
- A sub-resource nests under its parent (`/v1/projects/:projectKey/flags/:flagKey/environments/:environmentKey/rules`), not by repeating the prefix in each handler.
- Query parameters are camelCase and mirror the contract field names: `projectKey`, `environmentKey`, `includeArchived`, `includeRevoked`, `cursor`, `limit`.

## Validation

Every external input is parsed in the controller with a `packages/contracts` schema via `safeParse`; `await c.req.json()` is treated as `unknown` until then. A failed parse throws `ApiError.badRequest(firstIssue.message)` — the
first issue's message, not a field map. Path parameters the router guarantees are read through a helper that throws `badRequest` when one is missing, and a malformed JSON body is caught and reported as `badRequest("Send a valid JSON body.")`.

No validation middleware is used: no `@hono/zod-validator`, no per-route schema registry, no generated validator. The controller is the parse boundary. The approve/reject decision body is the one variation — the controller reads
`c.req.text()` and treats an empty body as `{}`.

## Cross-tenant reads

Queries are scoped by the session's `organizationId`, never by the body, a query parameter or a path segment. A read outside the caller's tenant or project membership answers 404 (`ApiError.notFound`), not 403: a 403 would confirm
the resource exists and enable enumeration. 403 remains the answer where the caller can see the resource but not act on it. The reasoning is in `docs/architecture.md §3`; the matrix and gate are in `docs/authorization.md`.

## Versioning and the OpenAPI gap

All Dariise endpoints live under `/v1`; the only paths outside it are Better Auth's `/api/auth/*` and the operational `/healthz` and `/readyz`.

No OpenAPI document is served: there is no `/v1/openapi.json` route, and no specification is generated from the Zod contracts.
Generating one from those contracts is an open gap in `docs/architecture.md §9`; the other gaps on that list are not API conventions.

## Status

- Exists: `packages/contracts` as the single source of truth; the `controller → service → repository` layering with `app.ts` as the only composition root; the sixty-three routes above;
  the `ApiError` envelope and the seven-value `ERROR_CODE` vocabulary; controller-side `safeParse` validation; cursor pagination on the list endpoints named above.
- Partial: two list endpoints return a bare array with no cursor — `GET /v1/projects` and `GET /v1/projects/:projectKey/members`.
- Not built: an OpenAPI document. `/v1/openapi.json` is not served and no specification is generated from the contract schemas (`docs/architecture.md §9`).

## Where it lives

- `apps/api/src/app.ts` — composition root, global middleware, router mounts and the single error boundary.
- `apps/api/src/server.ts` — the Node listener and graceful shutdown; no route or contract logic.
- `apps/api/src/middleware/authorization.ts` — `createSessionMiddleware`, `requireSession`, `requireWorkspace`.
- `apps/api/src/shared/http/errors.ts` — `ApiError`, its factories and `errorResponse`.
- `apps/api/src/shared/constants.ts` — the `ERROR_CODE` vocabulary.
- `apps/api/src/shared/pagination.ts` — `encodeCursor`, `decodeCursor`, `toPage`.
- `apps/api/src/shared/types/pagination.ts` — the `Page<T>` interface.
- `apps/api/src/modules/*/*.routes.ts` — one router per module; the paths in the inventory above.
- `packages/contracts/package.json` — the `exports` and `imports` maps.
- `packages/contracts/src/index.ts` — the root re-export of every subpath.
- `packages/contracts/src/pagination.ts` — `paginationQuerySchema`, the page sizes, `paginatedSchema`.
- `packages/contracts/src/errors.ts` — `apiErrorSchema` and `ApiErrorBody`.
- `packages/contracts/src/query.ts` — `booleanQueryParamSchema`.
- `.agents/skills/api/` — the long-form module, routing, contract and validation rules.
