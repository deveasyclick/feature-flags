# Domain model

The persistent shape of Dariise: the tenancy tree, where a flag actually sits, how keys
differ from ids, per-entity lifecycle, the table inventory, and the audit trail.

Access control is `docs/authorization.md`; flag configuration anatomy is `docs/flags.md`;
the approval workflow is `docs/change-requests.md`; the evaluation algorithm is
`docs/evaluation.md`; the wire contract is `docs/api-conventions.md`. None of them is
repeated here.

## Tenancy and identity

`organization` is the workspace and the tenant. It is a Better Auth table, and there is
no separate tenant table: every scoped row reaches its tenant through an `organization_id`
column, directly or by walking the tree.

```text
organization                     workspace / tenant
└── project                      project.organization_id NOT NULL
    ├── project_members          per-project role, distinct from the workspace role
    ├── flags                    flags.project_id NOT NULL
    │   └── flag_variations      the values every environment selects among
    ├── flag_dependencies        project-scoped, keyed by flag key
    ├── segments                 segments.project_id NOT NULL
    │   └── segment_conditions
    └── environments             environment.project_id NOT NULL
        ├── flag_environment_configs    one per (flag, environment)
        │   ├── targeting_rules ─ targeting_conditions
        │   └── flag_individual_targets
        ├── flag_versions               one per (flag, environment)
        ├── flag_change_requests        one per (flag, environment)
        └── api_keys             environment-scoped when environment_id is not null
```

Identity is Better Auth's: `user`, `session`, `account`, `verification`. Membership in a
workspace is the `member` row, whose `role` is a workspace role. `organization.slug` is
globally unique; `organization.metadata` exists because Better Auth requires it, and
nothing writes to it yet.

How identity becomes an access decision is `docs/architecture.md §2` and
`docs/architecture.md §3`.

## Where a flag sits

A flag belongs to the project, not to an environment. `flags.project_id` is `NOT NULL` and
the flag row carries only identity: key, name, description, type, tags, owner and status.
The unique index `flag_project_key_idx` is on `(project_id, key)`, so a flag key is unique
within its project.

What that flag does in one environment is a `flag_environment_configs` row: `enabled`, the
off and default variation keys, the rollout percentage and the bucketing attribute. It is
keyed by `(flag_id, environment_id)`, unique through `flag_environment_config_idx`.
Configurations are eager: creating a flag writes one for every environment of its project,
archived environments included, and creating an environment writes one for every flag. A
flag therefore always has a configuration in every environment; a missing row is a bug, and
evaluation answers `flag_not_found` rather than invent one.

Variations stay with the flag. `flag_variations` is keyed by `flag_id` alone, so every
environment selects among the same values; `docs/flags.md` owns that contract and
`docs/evaluation.md` owns how a configuration decides.

## Keys and ids

`key` is the human name that appears in URLs and API paths; `id` is the internal primary
key used by foreign keys. Every table has a `text` primary key `id`.

| Entity | URL key | Uniqueness | Internal reference |
| --- | --- | --- | --- |
| workspace | `organization.slug` | globally unique | `organization_id` |
| project | `project.key` | per `(organization_id, key)` | `project_id` |
| environment | `environment.key` | per `(project_id, key)` | `environment_id` |
| flag | `flag.key` | per `(project_id, key)` | `flag_id` |
| segment | `segment.key` | per `(project_id, key)` | `segment_id` |

`project.key` is unique per workspace, not globally: two tenants may both have a project
called `web-app`. The paths confirm the
convention — `/v1/projects/:projectKey/flags/:flagKey` and
`/v1/projects/:projectKey/segments/:segmentKey`.

The convention is not universal. `targeting_rules.segment_keys` is a `text[]` of segment
keys rather than a join table, and `flag_dependencies` stores `key`, `requires` and
`referenced_in` as flag keys scoped by `project_id` rather than flag ids.

## Lifecycle

### Project

A project has `created_at` and `updated_at` and nothing else: no archive, soft-delete or
`deleted_at` column, and no route removes one. The status is the row's existence.
`project.default_environment_id` is plain text with no foreign key, so the pointer to the
project's default environment is kept correct by application code rather than by the database.
Creating a project also creates its starter environments in the same transaction —
`development`, which is the default, and `production` — so a project cannot be left without
somewhere to put a flag. Any further environment arrives later through the environments API.

### Environment

An environment is archived rather than deleted. Archiving does all of the following
inside one transaction:

- keeps every flag of the project and this environment's configuration of each in place —
  the service calls archiving the reversible half of deletion;
- revokes that environment's own SDK keys: every `api_keys` row whose `environment_id`
  is this environment and whose `revoked_at` is null. Project-wide keys with a null
  `environment_id` are untouched;
- excludes the environment from the default list, which is what the environment switcher
  reads (`includeArchived` defaults to false);
- moves the default badge to a surviving active environment when the archived one held it.

A project must always retain at least one active environment: the active count is read
inside the transaction, and archiving the last one fails with a conflict. An archived
environment refuses ordinary updates until it is unarchived.

Restore is possible through unarchive, but it is not a rollback: the keys the archive
revoked stay revoked, so a restored environment has its configuration back and no usable
environment-scoped key until a new one is created.

### Flag

`flags.status` defaults to `active` and is project-wide: archiving sets it to `archived`
for every environment at once, and there is no per-environment archive. `enabled` is the
per-environment switch and is a column of `flag_environment_configs`, so a project-active
flag can be turned off in Production alone. Evaluation treats an archived flag in every
environment as that environment's off variation: the engine returns the off variation with
the `flag_archived` reason before it considers enablement or targeting. Because that makes
the configuration moot, an identity update is the only write an archived flag accepts;
configuration, rules, targets and variations all answer 409 until it is unarchived.
Archiving deletes nothing — variations, each environment's configuration, rules and
individual targets stay.

### Segment

A segment is archived rather than deleted: archiving sets `archived_at`, and the removal
route is the archive. Targeting rules reference a segment by key rather than by foreign
key, so deleting the row would strand them. Archived segments are excluded from the
default list unless `includeArchived` is requested, and there is no unarchive route.

## Table inventory

Every table is defined with `pgTable` in `apps/api/src/db/schema/`. Identity and auth
tables are Better Auth's shape, not Dariise's.

**Identity and auth (Better Auth)**

- `user` → the person: name, unique email, verification flag, image.
- `session` → one signed-in session: token, expiry, ip, user agent, `active_organization_id`.
- `account` → a credential or OAuth link for a user, including the password hash.
- `verification` → short-lived verification identifier/value pairs.
- `organization` → the workspace: name, unique slug, logo, metadata.
- `member` → a user's membership in a workspace and their workspace role.
- `invitation` → an invitation of an email into a workspace.

**Workspace and project**

- `project` → one project: organization, unique-per-workspace key, name, description, color, owner team, default environment id.
- `project_members` → a user's role on one project, distinct from the workspace role.
- `user_preferences` → per-user defaults: default project and environment, theme, notification switches.

**Environment**

- `environments` → one environment of a project: key, name, color, `is_default`, `is_protected`, `archived_at`.

**Flag configuration**

- `flags` → the flag's identity: key, name, description, type, tags, owner, status.
- `flag_environment_configs` → what one flag does in one environment: enabled, off/default variation keys, rollout percentage, bucket attribute.
- `flag_variations` → one servable value of a flag: key, name, jsonb value, priority.

**Targeting and segments**

- `targeting_rules` → one ordered rule of a flag in one environment: priority, variation key, referenced segment keys, optional rollout and bucket attribute.
- `targeting_conditions` → one condition of a targeting rule: attribute, attribute type, operator, jsonb values, priority.
- `flag_individual_targets` → one explicit subject override in one environment: subject id, variation key.
- `segments` → one project-scoped segment: key, name, description, `archived_at`.
- `segment_conditions` → one condition of a segment: attribute, attribute type, operator, jsonb values, priority.

**History and dependencies**

- `flag_versions` → a snapshot of a flag in one environment written on publish: version number, description, author, jsonb snapshot.
- `flag_dependencies` → one project-scoped dependency edge by flag key: `requires` and `referenced_in`.

**Change requests and credentials**

- `flag_change_requests` → a proposed change to a flag's configuration in a protected environment: status, jsonb payload, requester and decider ids and names, decision note.
- `api_keys` → an SDK or management credential: kind, name, unique prefix, secret hash, scopes, expiry, revocation and last use.

**Audit**

- `audit_log` → one recorded action: organization, optional project and environment, action name, actor, snapshotted actor name, target, jsonb changes.

`apps/api/src/db/schema/index.ts` is the only barrel; a table not exported there is not
part of the schema surface. That rule is `docs/architecture.md §6` and
`docs/development.md`.

## Child tables and the flag

A flag owns its rows, and each cascades on the flag's deletion:

- `flag_variations` → `flag_id`, unique per `(flag_id, key)`. Variations belong to the flag and are shared by every environment, which selects among them.
- `flag_environment_configs` → `flag_id` and `environment_id`, unique per `(flag_id, environment_id)`: one row for every environment of the project, written when either is created.
- `targeting_rules` → `flag_id` and `environment_id`, ordered by `priority`; each rule's `targeting_conditions` hang off `rule_id` and are AND-ed.
- `flag_individual_targets` → `flag_id` and `environment_id`, unique per `(flag_id, environment_id, user_id)`. The `user_id` is the evaluation subject id the engine matches, not a dashboard user, and it is plain text with no foreign key.
- `flag_versions` → `flag_id`, `environment_id` and `project_id`, unique per `(flag_id, environment_id, version)`, written on configuration publish and read by the history screen. History is per environment: each starts at its own version 1.

Dependencies are the exception to ownership. `flag_dependencies` holds a `project_id`, a
`key` and a `requires` key, so it links two flags by key within one project rather than by
flag id; `requires` is evaluated before `referenced_in`, which is why the dependency screen
shows an evaluation order rather than a cycle.

Segments are project-scoped, not flag-scoped. `segment_conditions` → `segment_id`, and a
targeting rule reaches a segment through the `segment_keys` array on its own row, so
several flags in one project can reference the same segment.

## Audit trail

Every audited mutation calls `writeAuditLog`, the only writer of `audit_log` rows. It takes
the caller's transaction:

> Callers pass their mutation's transaction: the row and the change it describes
> must commit together, or the entry is lost when the process dies in between.

`AuditEntry` carries:

```ts
interface AuditEntry {
  organizationId: string;
  actor: string;
  actorName?: string | null;
  action: string;
  target?: string | null;
  projectId?: string | null;
  environmentId?: string | null;
  changes?: unknown;
}
```

The helper generates `id` itself and passes the optional fields through as null when they
are absent, so a stored row always has all nine of these columns plus `created_at`. A
workspace-level event leaves `projectId` and `environmentId` null.

The action names actually written, derived from the `action` values passed to
`writeAuditLog` across `apps/api/src` — 27 in total:

```text
project.created            project.updated
environment.created        environment.updated
environment.archived       environment.unarchived
flag.created               flag.updated
flag.enabled               flag.disabled
flag.archived              flag.unarchived
flag.variation.added       flag.variation.updated
flag.variation.removed
rollout.updated
segment.created            segment.updated
segment.archived
api_key.created            api_key.revoked
change_request.created     change_request.approved
change_request.rejected
project_member.added       project_member.updated
project_member.removed
```

`flag.enabled`, `flag.disabled` and `rollout.updated` are chosen at publish time from the
difference between the stored environment configuration and the incoming one; the rest are
literals at their call sites. Identity edits — name, description, tags, owner and archive —
are project-wide and write no `environmentId`, while a configuration, rule or target write
carries the environment it touched. `packages/contracts` declares two further names,
`project.deleted` and `api_key.rotated`, that no call site writes.

Three caveats on the row shape:

- `actor` is a raw id — a user id or an API key id — with no foreign key. `actorName` is the name snapshotted at the time, so a later rename does not rewrite history.
- `target` is a raw id of whatever the action affected (a project, flag, environment or segment id), also with no foreign key, and it is not typed per action.
- `changes` is an untyped `unknown` payload in `AuditEntry` and an unconstrained jsonb column in the table. There is no published shape for it, and its keys differ per action and per call site. `audit_log.project_id` and `audit_log.environment_id` are likewise plain text without foreign keys.

## Status

Existing today: the tenancy tree and its 24 tables, the project-scoped flag with its unique
`(project_id, key)` key and its eager per-environment configurations, the project,
environment, flag and segment lifecycles above, and the audit helper with its 26 written
action names.

Partial: audit coverage is per mutation, not per field — `changes` records whatever the
call site chose, and a write that never calls `writeAuditLog` leaves no trace. Three of
the notification switches in `user_preferences` round-trip through the preferences
endpoints, and nothing consumes them to send a notification;
`notify_on_rollout_complete` is stored and is neither read nor written.

Not built: project delete or archive (`project.deleted` is declared but unwritten); segment
unarchive; API key rotation (`api_key.rotated` is declared but unwritten). No foreign key constrains `project.default_environment_id`.

## Where it lives

- `apps/api/src/db/schema/index.ts` — the schema barrel; the complete list of exported tables.
- `apps/api/src/db/schema/organization.ts` — the workspace/tenant table and its unique slug.
- `apps/api/src/db/schema/user.ts`, `session.ts`, `account.ts`, `verification.ts` — Better Auth identity tables.
- `apps/api/src/db/schema/member.ts`, `invitation.ts` — workspace membership and invitations.
- `apps/api/src/db/schema/project.ts` — the project table, its key uniqueness and default environment pointer.
- `apps/api/src/db/schema/project-members.ts` — per-project roles.
- `apps/api/src/db/schema/user-preferences.ts` — per-user defaults and notification switches.
- `apps/api/src/db/schema/environments.ts` — the environment table and its archive column.
- `apps/api/src/db/schema/flags.ts` — the flag's identity table and its unique `(project_id, key)`.
- `apps/api/src/db/schema/flag-environment-configs.ts` — what a flag does in one environment, one row per `(flag_id, environment_id)`.
- `apps/api/src/db/schema/flag-variations.ts` — servable values.
- `apps/api/src/db/schema/targeting-rules.ts`, `targeting-conditions.ts` — targeting rules and their conditions.
- `apps/api/src/db/schema/flag-individual-targets.ts` — explicit subject overrides.
- `apps/api/src/db/schema/segments.ts`, `segment-conditions.ts` — project-scoped segments and their conditions.
- `apps/api/src/db/schema/flag-versions.ts` — publish-time snapshots.
- `apps/api/src/db/schema/flag-dependencies.ts` — project-scoped dependency edges by flag key.
- `apps/api/src/db/schema/flag-change-requests.ts` — proposed changes for protected environments.
- `apps/api/src/db/schema/api-keys.ts` — SDK and management credentials.
- `apps/api/src/db/schema/audit-log.ts` — the audit table.
- `apps/api/src/db/audit.ts` — `writeAuditLog`, the only writer of audit rows.
- `apps/api/src/shared/types/audit.ts` — the `AuditEntry` shape.
- `apps/api/src/shared/types/db.ts` — the `Transaction` type the audit helper is given.
- `apps/api/src/modules/projects/projects.service.ts` — project creation and update, and the starter environments.
- `apps/api/src/modules/environments/environments.service.ts` — the starter environments of a new project, environment archive, unarchive and the last-active-environment rule.
- `apps/api/src/modules/flags/flags.service.ts` — flag creation, identity updates, archive and unarchive, variations and the per-environment publish.
- `apps/api/src/modules/segments/segments.service.ts` — segment creation, update and archive.
- `packages/engine/src/evaluate.ts` — where an archived flag resolves to the off variation.
- `packages/contracts/src/audit-log.ts` — the declared `AUDIT_ACTIONS` list, including two names nothing writes.
