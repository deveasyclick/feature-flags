# Flags

A flag is a named switch, owned by a project, that can be served differently in each of the
project's environments. This document covers its anatomy, addressing, variations, targeting
rules, individual targets, percentage rollout, versions, dependencies and archiving; the
evaluation algorithm, the approval workflow and the role matrix belong to
`docs/evaluation.md`, `docs/change-requests.md` and `docs/authorization.md`.

## A flag's anatomy

A flag is two things: identity that belongs to the project, and a configuration that says
what it does in each environment. `docs/architecture.md §2` owns the scoping decision.

Identity lives in `flags`:

| Column in `flags`          | Wire field               | Meaning                                                                     |
| -------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `id`, `project_id`         | `id`, `projectId`        | Primary key and the owning project.                                         |
| `key`                      | `key`                    | Unique within the project; no update path exposes it.                       |
| `name`                     | `name`                   | Display name, 1–80 characters.                                              |
| `description`              | `description`            | Nullable, at most 280 characters.                                           |
| `type`                     | `type`                   | `boolean`, `string`, `number` or `json`; defaults to `boolean`.             |
| `tags`                     | `tags`                   | Non-empty strings; empty by default.                                        |
| `owner`                    | `owner`                  | Nullable free text, not a foreign key.                                      |
| `status`                   | `status`                 | Project-wide `active` or `archived`; defaults to `active`.                  |
| `created_at`, `updated_at` | `createdAt`, `updatedAt` | ISO timestamps on the wire.                                                 |

What it does in one environment lives in `flag_environment_configs`, keyed by
`(flag_id, environment_id)` and written for every environment of the project:

| Column in `flag_environment_configs`         | Wire field                         | Meaning                                                                               |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `enabled`                                    | `enabled`                          | Whether it serves here; defaults to `false`.                                          |
| `off_variation_key`, `default_variation_key` | `offVariation`, `defaultVariation` | Served when off (default `off`) and by default (default `on`).                        |
| `rollout_percentage`, `bucket_by`            | `rolloutPercentage`, `bucketBy`    | Integer 0–100, default `0`, and the subject attribute to bucket on, default `userId`. |
| `created_at`, `updated_at`                   | `createdAt`, `updatedAt`           | ISO timestamps on the wire.                                                           |

Creation takes `key`, `name`, optional `description`, `tags` and `owner`, an optional `type` —
and no `environmentKey`. It may also carry the whole set of values the flag starts with:

| Field              | Meaning                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `variations`       | The values to create, each `{ key, name?, value }`, in order.                     |
| `defaultVariation` | The key served when the flag is on and nothing else selects a value.             |
| `offVariation`     | The key served when the flag is off, and as the SDK's fallback.                  |

The three are given together or not at all. A caller content with the conventional pair omits
them, and the API seeds `on` at priority 0 and `off` at priority 1 from
`defaultVariations(type)` — the same two values every other type uses. A **string flag may start
with any number of values**, which is how a multivariate experiment begins: `control`, `compact`
and `one-page` in one request, with `defaultVariation` and `offVariation` naming two of them.
Every other type is kept to the `on`/`off` keys, because targeting rules and the SDK preview
assume that pair; giving one a list of its own is refused with "Only a string flag can be created
with a variation list of its own."

`variations` is refused when any two entries share a key ("Every variation needs a different
key."), when a value does not match the declared `type`, or when `defaultVariation` or
`offVariation` names a key the list does not carry. Each starting variation's label is its `name`,
or its key with the first letter capitalised, and every environment's configuration is created
selecting `defaultVariation` and `offVariation`, so a
configuration never points at a variation that does not exist.

A value that does not match the declared type is refused at creation and on every later variation
write. All four types are selectable in the create form, and the variations editor renders a value
control chosen by the declared type. A boolean flag's two values are the two booleans and nothing
more is asked for. Another type is asked for a list of keyed values, starting at two, and which of
them the default and the off slots select; a string flag may add as many as it needs. The type
cannot be changed after creation. `updated_at` moves on an identity
update and an archive; a configuration publish moves that configuration's `updated_at`, not the
flag's.

## Addressing a flag

`flags.project_id` is `NOT NULL` and the key is unique per project through the index
`flag_project_key_idx` on `(project_id, key)`, so a flag key names exactly one flag in its
project. The canonical address is `/v1/projects/:projectKey/flags/:flagKey`, the only one
complete without query parameters.

`GET /v1/projects/:projectKey/flags` lists every flag of the project with a per-environment
summary, and `environmentKey` is an optional filter that narrows each row to that one
environment. `GET /v1/flags` is the workspace-wide list across every project in the
session's workspace, optionally narrowed by `projectKey`, `environmentKey`, `status` and
`search`, with each row carrying its `projectKey` so the screen renders outside a project.
`GET /v1/flags/:flagKey` resolves a key when the project is not known: `projectKey` is
required and `environmentKey` is optional, a missing `projectKey` is a 400, and the answer is
the canonical detail.

## The flag route inventory

`FLAG` below is `/v1/projects/:projectKey/flags/:flagKey`.

| Method   | Path                                                    | What it does                                                                                                                                    | Minimum project role       |
| -------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `GET`    | `/v1/flags`                                             | Workspace-wide list across every project in the workspace.                                                                                      | none — session's workspace |
| `GET`    | `/v1/flags/:flagKey`                                    | Resolve one flag from the `projectKey` query parameter.                                                                                         | `viewer`                   |
| `GET`    | `/v1/projects/:projectKey/flags`                        | List the project's flags; optional `environmentKey` filter.                                                                                     | `viewer`                   |
| `POST`   | `/v1/projects/:projectKey/flags`                        | Create; the body names no environment; answers 201.                                                                                             | `engineer`                 |
| `GET`    | `FLAG`                                                  | Identity, per-environment summaries and the flag's variations.                                                                                  | `viewer`                   |
| `PATCH`  | `FLAG`                                                  | Update identity: `name`, `description`, `tags`, `owner`.                                                                                        | `engineer`                 |
| `DELETE` | `FLAG`                                                  | Archive the flag in every environment.                                                                                                          | `engineer`                 |
| `GET`    | `FLAG/variations`                                       | Read the flag's variations.                                                                                                                     | `viewer`                   |
| `POST`   | `FLAG/variations`                                       | Add a variation; answers 201.                                                                                                                   | `engineer`                 |
| `PATCH`  | `FLAG/variations/:variationKey`                         | Edit a variation's name, value or description; the key is immutable.                                                                            | `engineer`                 |
| `DELETE` | `FLAG/variations/:variationKey`                         | Remove a variation; 409 while an environment references it.                                                                                     | `engineer`                 |
| `GET`    | `FLAG/environments/:environmentKey`                     | That environment's configuration: `enabled`, `offVariation`, `defaultVariation`, `rolloutPercentage`, `bucketBy`, rules and individual targets. | `viewer`                   |
| `PATCH`  | `FLAG/environments/:environmentKey`                     | Publish `enabled`, `offVariation`, `defaultVariation`, `rolloutPercentage` and `bucketBy`; variations are not part of it.                       | `engineer`                 |
| `PATCH`  | `FLAG/environments/:environmentKey/enabled`             | Flip `enabled` alone, for the flag list's quick toggle. Switching on also sets the rollout to 100.                                              | `engineer`                 |
| `GET`    | `FLAG/environments/:environmentKey/rules`               | Read the ordered targeting rules.                                                                                                               | `viewer`                   |
| `PUT`    | `FLAG/environments/:environmentKey/rules`               | Replace the whole targeting rule set.                                                                                                           | `engineer`                 |
| `GET`    | `FLAG/environments/:environmentKey/targets`             | Read the individual targets.                                                                                                                    | `viewer`                   |
| `PUT`    | `FLAG/environments/:environmentKey/targets`             | Replace the whole individual target set.                                                                                                        | `engineer`                 |
| `GET`    | `FLAG/environments/:environmentKey/versions`            | Read that environment's configuration history, paginated.                                                                                       | `viewer`                   |
| `GET`    | `FLAG/dependencies`                                     | Read the project-scoped dependency graph around the flag.                                                                                       | `viewer`                   |

Every route runs behind the session middleware and resolves the workspace first, so a caller
with no workspace answers 404. The minimum role is what the service method passes to the project
access gate (`docs/authorization.md`). A configuration, rules or targets write aimed at a
protected environment answers 409 `approval_required` instead of writing — the `enabled` toggle
included; identity edits are project-wide and direct, so protected environments do not gate them.
`docs/change-requests.md` owns what follows.

## Variations

A variation is one value the flag can serve, and it belongs to the flag rather than to an
environment: rows in `flag_variations` keyed by `flag_id`, with a `key` unique within the flag
(`flag_variation_flag_key_idx`), a `name`, a `value` (`jsonb`, its legal shapes decided by the
flag's `type`), a nullable `description`, and a `priority`. Creation inserts the requested list in
order, or the conventional `on` at priority 0 and `off` at priority 1 named "On" and "Off" when the
caller declares none. The wire variation is
`{ key, name, value, description }`: priority is not on the wire, but reads are ordered by it.
Every environment selects among the same keys.

Variation keys are identifiers, not labels. `PATCH FLAG/variations/:variationKey` edits `name`,
`value` or `description` and never the key: a rename is a new key plus explicit re-pointing, not
an edit. `DELETE FLAG/variations/:variationKey` is refused with 409 while any environment
references the key — as its `offVariation` or `defaultVariation`, as a rule's `variation`, or as
an individual target's `variationKey` — and the refusal names the referencing environments until
they are re-pointed. The three writes are audited as `flag.variation.added`,
`flag.variation.updated` and `flag.variation.removed`.

`offVariation` and `defaultVariation` name keys among the flag's variations. A configuration
publish refuses a key the flag does not have, and a rule's `variation` and a target's
`variationKey` are checked against the flag's variations the same way.

## Targeting rules

Rules live in `targeting_rules` keyed by `flag_id` and `environment_id`, their conditions in
`targeting_conditions` keyed by `rule_id`. A rule has `priority`, an optional `description`, the
`variation_key` it serves, `segment_keys` (a text array), `rollout_percentage` and `bucket_by`; a
condition has `attribute`, `attribute_type`, `operator`, `values` (a `jsonb` array) and
`priority`. Rules are ordered by priority within one environment and the conditions inside one
rule are AND-ed. A rule may reference segments by key, and a publish refuses a key that is not a
segment of the project; how a segment then contributes to matching is `docs/evaluation.md`.

A rule may carry its own rollout, `rollout.percentage` (0–100) and `rollout.bucketBy`, which
gates the rule itself: it applies only when the subject's bucket is below the percentage, so 0
means the rule never applies and 100 means it always does. The rule's `bucketBy` overrides the
environment configuration's for that check and falls back to the configuration's when the rule
carries none. A rule that stored no bucketing attribute reads back as `bucketBy: "userId"`, and
one published without a rollout reads back as `rollout: null`.

`GET FLAG/environments/:environmentKey/rules` returns that environment's rules in priority order
with their conditions. The matching `PUT` replaces the whole set: the existing rules and
conditions are deleted and the submitted array is inserted in order, with priority as the array
index and each condition's priority as its index in the rule. The publish is refused for an
unknown variation or an unknown segment.

## Individual targets

An individual target overrides one user in one environment: rows in `flag_individual_targets`
with `flag_id`, `environment_id`, `user_id` and `variation_key`, unique per
`(flag_id, environment_id, user_id)`. The service checks that `variationKey` names a variation of
the flag but does not reject duplicate `userId` values itself — the unique index is the only
guard. `GET FLAG/environments/:environmentKey/targets` returns `[{ userId, variationKey }]`, and
the matching `PUT` replaces the whole set. The evaluation engine looks for a target whose
`userId` equals the subject id after the archived and disabled checks and before any targeting
rule, reporting the reason `targeting_rule` when it serves one; the full order is
`docs/evaluation.md`.

## Percentage rollout per environment

`rolloutPercentage` is an integer 0–100 on the environment's configuration and `bucketBy` names
the subject attribute to bucket on, falling back to the subject id when that attribute is absent.
Below 100 the engine buckets the subject and serves the default variation under the threshold and
the off variation at or above it, with the reason `percentage_rollout`. Both endpoints are
thresholds like any other: 0 sends everybody to the off variation, and only 100 skips the bucket
and serves the default variation to everyone with the reason `default_variation`. The hash is
defined in `docs/evaluation.md`.

**The flag-level percentage splits exactly two variations: the default and the off variation.** It
is not a weighted distribution across the flag's whole variation set. To serve one variation to a
share of subjects and a different one to the rest, set `defaultVariation` to the first and
`offVariation` to the second — `defaultVariation: variant-a`, `offVariation: control`,
`rolloutPercentage: 10` sends 10% to `new-checkout` and 90% to `old-checkout`.

### Splitting three or more variations

Three or more variations are split with **ordered rules that carry their own rollout**, because
every rule's gate is checked against the same bucket for the same subject and the rules run in
priority order. A rule with no conditions matches everybody, so consecutive thresholds partition
the population:

| Priority | Conditions | Rule rollout | Serves      | Buckets  |
| -------- | ---------- | ------------ | ----------- | -------- |
| 0        | none       | 10           | `variant-a` | 0–9      |
| 1        | none       | 50           | `variant-b` | 10–49    |
| —        | —          | —            | `control`   | 50–99    |

The last row is the configuration's `defaultVariation`, reached when no rule gate applies. The
shares are cumulative thresholds, not independent percentages: rule 2's 50 means "the first half",
so 40% of subjects land on `variant-b`. A subject's bucket never changes while the flag key and
the bucket attribute stay the same, so a split does not reshuffle when a threshold is raised.

## Versions and history

`flag_versions` records `project_id`, `flag_id`, `environment_id`, `version`, `description`,
`author`, `snapshot` (`jsonb`) and `created_at`, unique per `(flag_id, environment_id, version)`,
with `nextVersion` one past the highest version that flag already has in that environment.
History is per environment: each environment's history starts at its own version 1.

| Event                   | Description in the row                               | Snapshot                                |
| ----------------------- | ---------------------------------------------------- | --------------------------------------- |
| Flag created            | `Flag created`                                       | environment, key, type, tags            |
| Configuration published | `Configuration published to <environment name>`      | environment, enabled, serve, variations |
| Rules published         | `Targeting rules published to <environment name>`    | environment, rules                      |
| Targets published       | `Individual targets published to <environment name>` | environment, targets                    |
| Configurations copied   | `Copied from <source environment name>`              | environment, key, type                  |

An identity update and an archive write an audit row but no version row.
`GET FLAG/environments/:environmentKey/versions?limit&cursor` returns `{ data, nextCursor }`,
newest first, with the cursor being the last version number of the page. Each entry is
`{ version, environmentKey, description, author, serve, createdAt }`, where `author` is a user id
and `serve` is the default variation the publish served, read out of the snapshot; it is null for
versions whose snapshot recorded none, which is every create and copy row.

## Dependencies

`flag_dependencies` holds one row per edge, scoped to the project rather than an environment:
`project_id`, `key`, `requires`, an optional `referenced_in`, unique per
`(project_id, key, requires)`. `requires` is meant to be evaluated before `key`.
`GET FLAG/dependencies` reads the rows where the flag is either side of the edge and returns a
`FlagDependencyGraph` of `upstream` and `downstream` key arrays, a `summary` of `{ upstream,
downstream, circular, maxDepth }`, and an `evaluationOrder` of `{ key, status, isSelf }` nodes
with the flag marked `isSelf`. Node status is resolved by key across the whole project, and a
key names exactly one flag now that flag keys are unique per project.

Nothing in the API writes a `flag_dependencies` row: outside the test suite there is no insert,
no route and no service path that creates one, so the graph is empty unless rows exist.
Evaluation does not read the table at all — a dependency is not enforced when a variation is
decided, so a flag that is switched off has no effect on the flag that requires it.

## Archiving

`DELETE FLAG` is the only delete-like operation, and it is project-wide: it sets `status` to
`archived` and `updated_at` for the flag in every environment at once, returns
`{ key, status: "archived" }`, and writes the audit action `flag.archived` with `changes` of
`{ status: "archived" }` and no environment. There is no per-environment archive. Archiving and
disabling are different: `status` says the flag exists, while `enabled` on one environment's
configuration says whether that environment serves it, so a flag can be active everywhere and
still be turned off in Production alone. Everything stays: the row, its variations and each
environment's configuration, rules, targets and versions all remain and no cascade delete runs.
An archived flag evaluates in every environment as that environment's off variation with the
reason `flag_archived` (`docs/evaluation.md`). Archived flags appear in list responses unless the
caller filters by `status`, nothing refuses a write to an archived flag, and a second archive
behaves exactly like the first. There is no hard delete: no route or repository method removes a
flag row.

## Creating an environment from a copy source

Creating an environment always gives every flag of the project a configuration here, because a
flag is project-scoped. The request carries `initialFlagStatus`: `all-off` — the default — writes
every one of them disabled, so the environment exists and serves nothing; `copy-source`, where
`copyFrom` names the source and is required, copies every flag's configuration from that
environment, including its rules and individual targets. `all-off` refuses a `copyFrom`. The
route belongs to the environments module.

The copy runs inside the same transaction that inserts the environment, through the copy
primitive the flags service exposes to the environments module, so an environment is never
half-populated. Each copied configuration starts that environment's history at version 1,
described as `Copied from <source environment name>`. The new configurations have no audit rows
of their own: `environment.created` records the whole thing once, with `changes` of `{ key,
name, initialFlagStatus, copyFrom, configuredFlags }`, project-level and naming no environment.
A source that does not exist fails before anything is written.

## Condition operators

A condition stores its `operator` as free text beside its `attribute` and `values`. The set the
dashboard offers is `equals`, `not_equals`, `contains`, `not_contains`, `in`, `not_in`,
`greater_than`, `greater_than_or_equal`, `less_than`, `less_than_or_equal` and
`matches_regex`; anything outside it matches nothing.

How an operator decides a match — string coercion, what a missing attribute does, and how an
invalid pattern is handled — is engine behaviour and lives in `docs/evaluation.md`.

## Status

**Exists.** The nineteen routes above; the `flags`, `flag_environment_configs`,
`flag_variations`, `targeting_rules`, `targeting_conditions`, `flag_individual_targets`,
`flag_versions` and `flag_dependencies` tables; create, canonical and workspace-wide read,
identity update, the variation routes, configuration publish, rule and target replacement,
per-environment versions and archiving. Protected environments refuse a direct configuration,
rules or targets write with 409 `approval_required`.

**Partial.** Flag dependencies: the table and the read endpoint exist, but nothing in the API
writes a row and evaluation never reads the table. The dashboard's archive control is rendered
disabled as a placeholder while `DELETE FLAG` works. A rule that carries a percentage but no
stored bucketing attribute reads back as bucketing by `userId` while evaluation falls back to the
configuration's `bucketBy`. Archived flags remain writable.

**Not built.** Hard delete — archiving is the only delete-like operation. Dependency enforcement
at evaluation time. Any flag configuration cache: reads reach PostgreSQL on every request
(`docs/architecture.md §8.1`).

## Where it lives

- `apps/api/src/modules/flags/flags.routes.ts` — the route table and its mounting.
- `apps/api/src/modules/flags/flags.controller.ts` — request validation, actor context, status codes.
- `apps/api/src/modules/flags/flags.service.ts` — roles, variations, the per-environment publish, versions, audit and environment copies.
- `apps/api/src/modules/flags/flags.repository.ts` — queries, including the configuration copy environment creation uses.
- `apps/api/src/modules/flags/flags.dependencies.ts` — dependency graph assembly.
- `apps/api/src/modules/flags/flags.mapper.ts` — wire shapes for list, detail, environment config, rules, targets and versions.
- `apps/api/src/modules/flags/flags.types.ts` — module types, including `FlagRow`.
- `packages/contracts/src/flag.ts` — the flag wire contract, type check and default values.
- `packages/contracts/src/environment.ts` — the copy-source input for environment creation.
- `packages/contracts/src/audit-log.ts` — the audit action vocabulary.
- `apps/api/src/db/schema/flags.ts` — the `flags` identity table and its unique project key index.
- `apps/api/src/db/schema/flag-environment-configs.ts` — the per-environment configuration table.
- `apps/api/src/db/schema/flag-variations.ts` — the `flag_variations` table.
- `apps/api/src/db/schema/targeting-rules.ts` — the `targeting_rules` table.
- `apps/api/src/db/schema/targeting-conditions.ts` — the `targeting_conditions` table.
- `apps/api/src/db/schema/flag-individual-targets.ts` — the `flag_individual_targets` table.
- `apps/api/src/db/schema/flag-versions.ts` — the `flag_versions` table.
- `apps/api/src/db/schema/flag-dependencies.ts` — the `flag_dependencies` table.
- `packages/engine/src/evaluate.ts` — the operator matching this section defers to.
- `apps/api/src/modules/environments/environments.service.ts` — environment creation and the copy transaction.
- `apps/web/components/app/flags/create-flag-form.tsx` — the create flow.
- `apps/web/components/app/flags/flag-configuration.tsx` — the per-environment configuration tab.
- `apps/web/components/app/flags/variation-value-input.tsx` — the value control chosen by flag type.
