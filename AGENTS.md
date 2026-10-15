# Iwifunni

Feature management and progressive delivery. pnpm monorepo:

| Path                 | What                                                         |
| -------------------- | ------------------------------------------------------------ |
| `apps/api`           | Hono 4 on Node.js, Drizzle over PostgreSQL, Better Auth      |
| `apps/web`           | Next.js App Router dashboard                                 |
| `packages/contracts` | Shared `zod` schemas — the wire contract, single source of truth |

## Gate

Run `pnpm check` from the repo root after any change. It runs `typecheck` + `lint` +
`test` across every workspace and must exit 0; `pnpm build` builds both apps.

A change is not finished while any of these fail. Never report success on work you did
not run them against, and never describe a check as passing that you did not execute.

## Read before editing

- `apps/api` — `.agents/skills/api/skill.md`: layering, types, validation, persistence,
  the wire contract, tests.
- Comments anywhere — `.agents/skills/comments/skill.md`: the default is no comment.
- `apps/web` — `apps/web/AGENTS.md`.

These are the long form. Below is only what breaks most often.

## The handful that break most often

- Layering is one-directional: `controller -> service -> repository`, nothing skipped or
  reversed. Only `app.ts` constructs the object graph.
- Exported types and constants never live inline in a controller, service, repository or
  mapper — they go in the module's `<name>.types.ts`, `src/shared/types/` or
  `src/shared/constants.ts`.
- Validate every external input with a `packages/contracts` schema, via `safeParse` in the
  controller. Treat `await c.req.json()` as `unknown` until parsed.
- Scope every query by the `organizationId` from the session, never the body, a query
  parameter or a path segment. A cross-tenant read answers 404, not 403.
- Failures use the `ApiError` factories and the envelope
  `{ error: { code, message, details? } }`. An unexpected error is logged and returned as a
  generic 500 with no internals.
- Read config through an app's config module — `src/config/index.ts` (api) or
  `shared/env.ts` (web) — never `process.env` ad hoc; those are the only modules that may
  read it. Each app's env file lives beside it (`apps/api/.env`, `apps/web/.env`), with a
  committed `.env.example` in the same directory. The API loads it with `dotenv/config`
  inside that module; the dashboard loads it explicitly in `next.config.ts` and reads it
  through `shared/env.ts`. The API test harness is the exception: it writes `process.env`
  before config loads.
- ESM with `NodeNext`: relative imports need an explicit `.js`, and `require`,
  `module.exports` and `__dirname` are unavailable.

## Finish the refactor

The most common defect here is a half-applied interface change: one side of a value's type
or construction moves while a call site keeps the old shape, and nothing catches it because
no type checker ran.

Update every call site in the same edit, then run `pnpm typecheck`. Do not hand back a
change that emits TypeScript errors.
