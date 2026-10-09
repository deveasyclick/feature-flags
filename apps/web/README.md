# Dariise Web

The Dariise dashboard: a Next.js App Router application for managing feature
flags, environments, targeting, and rollouts.

## Stack

- Next.js (App Router, Turbopack)
- TypeScript
- Tailwind CSS v4 via `@tailwindcss/postcss`
- shadcn/ui primitives
- JetBrains Mono (primary) and Geist (secondary) via `next/font`

## Development

`apps/web` is a workspace package, so dependencies are installed once from the
repository root:

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm dev
```

The dashboard runs at <http://localhost:3000>.

From the repository root:

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run `tsc --noEmit` |

Commands can also be scoped with `pnpm --filter web <script>`.

Only one `next dev` server can run per project; Next.js refuses to start a
second one and points at the existing server instead.

## Routes

| Route | Screen | Layout |
| --- | --- | --- |
| `/` | Sign in | `(auth)` |
| `/sign-up` | Create account | `(auth)` |
| `/forgot-password` | Reset password | `(auth)` |
| `/create-workspace` | Create workspace | `(auth)` |
| `/create-project` | Create project | `(getting-started)` |
| `/overview` | Dashboard overview | `(app)` |
| `/projects` | Projects list | `(app)` |
| `/projects/new` | Create a project | `(app)` |
| `/projects/[key]` | Project detail — Environments | `(app)` |
| `/projects/[key]/flags` | Project detail — Flags | `(app)` |
| `/projects/[key]/flags/[flagKey]` | Flag detail — Configuration / Variations / Targeting / History / Dependencies tabs via `?tab=`, with `?environment=` selecting the configuration | `(app)` |
| `/projects/[key]/members` | Project detail — Members | `(app)` |
| `/environments/[env]/flags` | Flags in one environment | `(app)` |
| `/environments/[env]/flags/new` | Create a flag | `(app)` |
| `/environments/[env]/flags/[key]` | Legacy flag detail; redirects to the project-scoped page with the matching tab | `(app)` |
| `/flags` | Redirect to the current environment's flag list | `(app)` |
| `/segments` | Segments list | `(app)` |
| `/segments/new` | Create a segment | `(app)` |
| `/segments/[key]` | Segment detail — Definition | `(app)` |
| `/segments/[key]/members` | Segment detail — Members | `(app)` |
| `/segments/[key]/flags` | Segment detail — Flags | `(app)` |
| `/environments` | Environments list | `(app)` |
| `/environments/new` | Create an environment | `(app)` |
| `/environments/[key]` | Environment detail — SDK keys | `(app)` |
| `/environments/[key]/coverage` | Environment detail — Coverage | `(app)` |
| `/environments/[key]/settings` | Environment detail — Settings | `(app)` |
| `/api-keys` | API keys list | `(app)` |
| `/api-keys/new` | Create an API key | `(app)` |
| `/sdks` | SDKs & Integration | `(app)` |
| `/analytics` | Analytics | `(app)` |
| `/audit-log` | Audit log | `(app)` |
| `/settings` | Settings — General | `(app)` |
| `/settings/security` | Settings — Security | `(app)` |
| `/settings/integrations` | Settings — Integrations | `(app)` |
| `/settings/billing` | Settings — Billing | `(app)` |
| `/profile` | Personal profile | `(app)` |

`(auth)` and `(getting-started)` share one two-column brand/form shell
(`AuthShell`) but not its copy: `(auth)` holds the access screens and the
create-workspace step, while `(getting-started)` holds the create-project step,
whose brand panel welcomes the user instead of pitching the product. `(app)`
shares the application shell — fixed sidebar, topbar, and a scrolling content
area — and is rendered per request so the dashboard figures and relative
timestamps stay current.

Route groups never appear in a URL, and `app/layout.tsx` remains the only root
layout.

The flag, segment, environment and project detail tabs are `<Link>`s rather
than tab state, so each one is a real, addressable route. Configuration,
Definition, SDK keys and Environments are the bare `/[key]` routes, matching
each design's default tab. An
unknown key calls `notFound()`.

The Settings sections follow the same rule: `app/(app)/settings/layout.tsx`
renders the title and the section nav once, and General, Security, Integrations
and Billing are four routes underneath it. `/settings` is General.

## Layout

```text
app/(auth)/             # Sign in, sign up, reset, create workspace
app/(getting-started)/  # Create project (last onboarding step)
app/(app)/              # Dashboard: overview, projects, flags, segments,
                        # environments, api keys, analytics, audit log, settings
app/layout.tsx          # Root layout: fonts, metadata, globals.css
app/globals.css         # Design tokens (see below)
components/app/         # Sidebar, project switcher, topbar, nav config, dashboard cards, table
components/app/projects/ # Project headers, tabs, cards, glyph map, create form
components/app/flags/   # Flag headers, tabs, dialogs, create form, tab panels
components/app/segments/# Segment headers, tabs, list, create form, tab panels
components/app/environments/ # Environment headers, cards, tabs, keys, coverage
components/app/api-keys/ # Key table, badges, create form and its note cards
components/app/analytics/ # Metric cards, evaluation chart, latency, top flags
components/app/audit-log/ # Timeline, change details and the filter view
components/app/sdks/    # SDK picker, connection panel, resources card
components/app/settings/ # Settings cards, section nav, profile, security, billing
components/app/profile/ # Personal profile, password and preference cards
components/app/account-menu.tsx # avatar dropdown in the topbar
components/app/copy-button.tsx # shared copy-to-clipboard button
components/app/environment-switcher.tsx # environment menu in the sidebar header
components/app/project-switcher.tsx # project menu in the sidebar header
components/app/settings-card.tsx # card shared by Settings and Profile
components/app/theme-choice.tsx # shared Light/Dark/System control
components/auth/        # Auth shell, shared fields, step path, and the five forms
components/ui/          # shadcn/ui primitives
components/logo.tsx     # brand mark
lib/analytics-data.ts   # analytics fixtures — the API has no metrics route
lib/api.ts              # typed client for the Dariise API
lib/auth-client.ts      # Better Auth client for the browser
lib/auth.ts             # auth actions: sign in/up, workspace, project creation
lib/billing-data.ts     # billing fixtures — the API has no billing route
lib/environment-color.ts # narrows the API's colour string to a palette key
lib/format.ts           # relative time, date and number formatters
lib/scope.ts            # the current project/environment, resolved from the API
lib/scope-actions.ts    # Server Actions the sidebar switchers write through
lib/sdk-data.ts         # SDK install snippets — documentation, not API data
lib/session.ts          # the signed-in user, resolved from the API
lib/validation.ts       # dependency-free form validators
```

Per-screen server loaders sit beside the route they serve — for example
`app/(app)/overview/load-overview.ts`, `app/(app)/audit-log/load-audit-log.ts`
and `app/(app)/projects/[key]/load-project.ts` — and the flags and segments areas
keep theirs in `components/app/flags/flag-queries.ts` and
`components/app/segments/segment-loader.ts`. They own the `notFound()` mapping
and the cursor-following loops, so pages stay declarative.

## Sidebar navigation

`components/app/nav-config.ts` lists every section from the design, but only an
entry with an `href` is a real link. Entries without one render as
non-interactive, dimmed, and announced to assistive technology as **Coming
soon** — nothing in the sidebar leads to a route that does not exist. To light
one up, build the screen and add its `href`.

The sidebar header holds two switchers: the project switcher
(`components/app/project-switcher.tsx`, fed by the workspace's real projects) and
the environment switcher (`components/app/environment-switcher.tsx`, fed by the
current project's real environments), which is what the design shows instead of a
workspace name. Both are functional: selecting a row writes a scope cookie
through the Server Actions in `lib/scope-actions.ts`, and every screen re-renders
against the new project or environment. Their footer actions navigate to the
screens that exist: Create environment
(`/environments/new`), Manage environments (`/environments`), Create project
(`/projects/new`) and Manage projects (`/projects`). Environments are therefore
reached through that switcher and the `/environments` route rather than a nav
entry.

## Design tokens

Every colour and font in the app resolves to a CSS custom property declared in
`app/globals.css`, grouped as:

- **auth-only** — `--auth-*`, used exclusively by the authentication screens
- **shared** — `--primary`, `--foreground`, `--background`, `--card`, `--muted`,
  `--border`, `--danger-ink`, `--info-ink`, and friends
- **app-only** — `--primary-ink`, `--ok-ink`, `--warn-ink`, `--slate-ink`,
  `--purple-ink`
- **navigation** — `--nav-*`, for the sidebar

Each group has light values in `:root` and dark values in `.dark`. The full app
palette is declared even where a screen does not use it yet, so the dashboard can
be built without changing the theme. Tokens marked `derived` in the file are the
few that shadcn primitives require but the design spec does not define; they are
taken from the documented scale.

Use the tokens rather than raw colours — `bg-auth-panel`, `text-danger-ink`,
`bg-info-ink/5` — so light and dark stay in step.

## Adding UI components

`components.json` is configured for the shadcn CLI with the `radix` base:

```bash
pnpm dlx shadcn@latest add <component>
```

## Configuration

`next.config.ts` loads `apps/web/.env` explicitly, before the build inlines
`NEXT_PUBLIC_*`; configuration is read in `shared/env.ts` (copy
`apps/web/.env.example`), the only module in this app that touches `process.env`.
Import it as `import env from "shared/env"` and read `env.environment`,
`env.apiUrl` and `env.apiInternalUrl`. Only variables prefixed with `NEXT_PUBLIC_`
reach the browser.

| Variable | Default | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Base URL of the Dariise API, as reached from the browser. Required for production builds. |
| `API_INTERNAL_URL` | `http://localhost:4000` | Server-only. Used by Server Components to call the API without a round trip through the public origin. |

See `docs/architecture.md` §8.3 for the intended cookie and origin setup. Today the
dashboard and the API are separate origins in development, and the client sends
`credentials: "include"` against the API's origin allowlist; a reverse
proxy under the web origin is still the intended production arrangement, so the
session cookie never leaves the first-party site.

## Notes

- Server Components are the default. Each page resolves its own data and renders
  small `"use client"` pieces — the auth forms, the sidebar (for `usePathname`),
  the account menu, the flags table (for search and filtering), the audit log view
  (for search, filtering and row selection), the API key table (for row menus and
  the key it just issued) and the create/edit forms.

### Where the data comes from

- **`lib/api.ts` is the only way to the API.** It is one thin typed client over
  `@dariise/contracts`, with no data-fetching framework attached. On the server it
  calls `API_INTERNAL_URL` and forwards the incoming session cookie; in the browser
  it calls `NEXT_PUBLIC_API_URL` with `credentials: "include"`. Server Components
  call its resource functions directly, Client Components call the mutations, and
  nothing calls `fetch` by hand.
- **`lib/scope.ts` resolves the current project and environment** from
  `projects.list` and `environments.list`, honouring the cookies the sidebar
  switchers write through `lib/scope-actions.ts`. It is `cache()`d, so a page and
  its layout share one resolution. A stale or unknown selection falls back to the
  first project and that project's default environment rather than failing.
- **Every API-backed screen is real.** Projects, environments, flags, segments,
  API keys, the audit log, workspace settings and the personal profile all read
  and write through `lib/api.ts`; there are no fixture modules left for them and no
  `*-stub.ts` stand-ins at all. A screen that cannot resolve its resource calls
  `notFound()`, and `ApiError.status` decides that.
- **Three modules are still fixtures, on purpose**, because the API exposes no
  route for them: `lib/analytics-data.ts` (no metrics endpoint),
  `lib/billing-data.ts` (no billing endpoint) and `lib/sdk-data.ts` (install
  snippets are documentation, not tenant data). Billing takes the real environment
  count from `getScope()` so its allowance cannot disagree with the Environments
  screen; the Analytics screen is the only one that is entirely design figures.
- **Per-screen loaders own the paging loops.** `app/(app)/overview/load-overview.ts`
  and `app/(app)/audit-log/load-audit-log.ts`, `app/(app)/projects/[key]/load-project.ts`,
  `app/(app)/environments/[key]/load-environment.ts`,
  `components/app/flags/flag-queries.ts` and
  `components/app/segments/segment-loader.ts` follow `nextCursor` where a complete
  set is required and map 404s to `null` so the page can call `notFound()`.

### What the API cannot answer yet

The screens say so rather than inventing a figure:

- **No count endpoints.** Counts come from one capped page and render `100+` (or
  the page size, e.g. `50+`) when `nextCursor` is set.
- **No metrics endpoint.** The Overview's evaluation/latency card was removed
  rather than printed from nothing; `scheduled` and `stale` became **In Rollout**
  and **Archived**, both derived from real flags. The Analytics screen keeps its
  design fixtures and is the one screen that is not API-backed.
- **No environment health endpoint**, so `health-badge.tsx` is gone and
  environments show their real `Default`/`Protected` flags instead of a made-up
  Healthy/Degraded.
- **No segment membership endpoint.** The Members tab and the Definition preview
  run locally over a fixed sample audience and are labelled as an estimate, not
  as this project's users.
- **No integrations, workspace-theme or account-created-at data**, so those cards
  render an explicit unavailable state, and no `GET` exists for preferences or
  notifications, so those forms start from the API's defaults and say that stored
  values cannot be read back.
- **`projects.create` takes only a name and the first environment.** The create
  screen keeps its colour, preset and initial-flag-state controls but states
  plainly that they are not applied yet; `environments.create` does model colour,
  copy source and initial flag status, so those are sent.
- **Audit `actor` and `target` are raw ids**, and `changes` is `unknown` with no
  published shape; the log renders ids as they arrive and flattens `changes`
  defensively instead of guessing a before/after structure.
- **A flag key is unique per project, not per workspace.** A flag is addressed
  under the project that owns it, and a workspace-wide row is reachable through
  its own project rather than opening a same-key flag from the current scope.
- `components/app/account-menu.tsx` is the avatar dropdown in the topbar; its
  `Sign out` is a real Better Auth call, not a stub.
- `components/app/copy-button.tsx` holds the one clipboard implementation. The
  SDK key chips, the connection rows and the API key screens all use it; the menu
  item that cannot be a button calls its `writeToClipboard` helper directly.
- The topbar's search and notifications are still presentational and marked as
  coming soon, as is the theme control — the design tokens ship dark values, but
  nothing switches them yet.
- Interactive controls without an implementation — `Auto segment`, `Add user`,
  `Edit` on a segment, `Edit environment`, `Create key`, `Delete environment`,
  version diffing, `Export`, `Export CSV`, `Revert this change`, `Rename key`,
  `Rotate key`, `Theme`, `Delete workspace`, `Manage` (SSO), `Add` (email
  domains), `Configure` (IP allowlist), `Connect`, `Open SDKs & Integration`,
  `Change plan`, `Update` (payment method), invoice downloads and `Change photo`
  — are disabled with a title rather than pretending to work. Creating flags,
  segments, environments, projects and API keys; editing a flag's identity and
  archiving it, from its row or its detail screen; opening a flag's version
  history from its row; archiving segments; revoking API keys; editing targeting
  rules and individual targets; saving environment settings; searching and
  filtering every list; the audit log's search, filters and row selection;
  saving the workspace and personal profiles; changing the password; the
  security, preference and notification controls; switching project and
  environment; signing out; and tab navigation all work against the API.

