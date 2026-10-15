# Evaluation

How a flag decision is produced: the endpoint, the rows that feed it, the pure engine that decides, and the bucketing that keeps a percentage rollout sticky. Flag configuration is in `docs/flags.md`; the approval workflow in `docs/change-requests.md`; the role matrix in `docs/authorization.md`; the wire contract, error envelope and pagination in `docs/api-conventions.md`.

## The purity invariant

`evaluate()` in `packages/engine/src/evaluate.ts` is a pure function from `EvaluationInput` to `EvaluationOutcome`. It receives rows that are already loaded and performs no I/O, reads no clock, draws no randomness and consults no cache. The only capability it reaches for outside its own types is `sha256` from `packages/engine/src/sha256.ts`, used deterministically by `bucketFor`, so the same input always produces the same decision.

That buys three things. A test can call `evaluate` and `bucketFor` directly with a literal input object, with no database, HTTP request or session, which is what `packages/engine/src/engine.test.ts` does. Each reason and each operator can be its own case, because the reason is part of the return value rather than a side effect. And because a decision depends only on the rows and the subject, it can be reproduced outside this process from the same inputs, which is the precondition for checking another implementation against this one later.

## Resolution order

The engine returns at the first step that produces a variation.

1. **Archived flag.** `flag.status === "archived"` serves `config.offVariation` with reason `flag_archived`; `matchedRuleId` is `null`, and `enabled` is false because the served variation is the off variation.
2. **Disabled flag.** `config.enabled` false serves `config.offVariation` with reason `flag_disabled`, again with `matchedRuleId` `null` and `enabled` false.
3. **Individual targets.** The first entry of `input.targets` whose `userId` equals `subject.id` serves that entry's `variationKey` with reason `targeting_rule` and `matchedRuleId` `null`. This step has no reason of its own: a target match reports `targeting_rule`.
4. **Ordered targeting rules.** The first rule that matches serves the rule's `variation` with `matchedRuleId` set to the rule id, and reason `segment` when the rule references at least one segment key, otherwise `targeting_rule`. The gates are in "Rule evaluation semantics" below.
5. **Flag-level percentage rollout.** When `rolloutPercentage < 100`, the subject is bucketed and the engine serves `config.defaultVariation` when the bucket is below the percentage and `config.offVariation` otherwise, always with reason `percentage_rollout` and `matchedRuleId` `null`. `0` is a threshold like any other, so it sends every subject to the off variation; only `100` skips the bucket.
6. **Default variation.** Any other flow serves `config.defaultVariation` with reason `default_variation` and `matchedRuleId` `null`.

A flag, environment or configuration that does not resolve never reaches the engine.
`EvaluationService.evaluate` in `evaluation.service.ts` calls `repository.findTarget` and, when
it returns `null`, returns `{ variation: "off", enabled: false, reason: "flag_not_found",
matchedRuleId: null }` itself, echoing the requested flag key. `flag_not_found` is produced by
the service, not the engine.

## Evaluation reasons

The vocabulary is `EVALUATION_REASONS` in `packages/contracts/src/evaluation.ts`.

| Reason               | Produced when                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `flag_not_found`     | The service resolved no flag, no environment or no configuration of that flag in that environment, in the caller's workspace. |
| `flag_archived`      | The resolved flag's status is `archived`.                                                            |
| `flag_disabled`      | The resolved flag's configuration has `enabled` false.                                               |
| `targeting_rule`     | An individual target matched, or a targeting rule with no segment references matched.                 |
| `segment`            | The matching rule references at least one segment key and every referenced segment resolved and matched. |
| `percentage_rollout` | The flag-level rollout branch ran, that is `rolloutPercentage < 100`.                                |
| `default_variation`  | The flag-level rollout branch did not run, so the default variation was served.                       |
| `error`              | Never, today. The value exists in the contract vocabulary but no source file in `apps/api` produces it. |

`error` has no producer, and an evaluation failure is not mapped onto it. The engine throws nothing for bad input, and anything that does throw inside a request reaches `app.onError((error, c) => errorResponse(c, error))` in `app.ts`, which answers a generic 500 with code `internalError` and no internals (`apps/api/src/shared/http/errors.ts`).

## Attribute naming

The subject is flat: `id` plus one key per attribute, and a condition's `attribute` is read with
`subject[attribute]` - literally, with no path resolution and no prefix stripping. A rule on `beta`
therefore matches an attribute named `beta`, and a rule on `user.beta` matches only a context that
carries the key `user.beta`. The SDK builds the same flat subject from
`identify({ userId, attributes })` by spreading `attributes` onto it, so the keys an application
sends are the attribute names the dashboard has to target; `docs/sdk.md` states the SDK's side. `id`
is the subject id, so an attribute of that name is the id rather than a value to look up.

Condition `values` are always strings whatever the attribute's declared type, and `attributeType` is
carried on the row but never consulted: "Condition operators" below has the comparison rules.

## Rule evaluation semantics

A rule is a conjunction of three gates, each of which can skip it.

- **Conditions are AND-ed.** `allConditionsMatch` uses `Array.prototype.every`, so every condition on the rule must satisfy the subject. An empty condition list passes vacuously.
- **Referenced segments must all match.** `rule.segmentKeys` is checked with `every`: each key must resolve to a segment in `input.segments` and that segment's own conditions must all match, decided by the same operator rules. A referenced key that cannot be found counts as not matching, so the rule is skipped rather than served. With no segment keys the check passes vacuously.
- **The rule's own rollout gates the rule.** When `rule.rolloutPercentage` is not `null`, the subject is bucketed with `rule.bucketBy ?? config.bucketBy`, and the rule is skipped when the bucket is greater than or equal to the percentage. `0` therefore never applies the rule and `100` always does. The flag key is always the hash input, and a rule may override `bucketBy`.

A gate that fails executes `continue`: the rule is abandoned, nothing is recorded, and evaluation moves to the next rule in the order the repository returned. Only a fully matching rule serves, and only then does its id become `matchedRuleId`. If every rule is skipped, evaluation continues to the flag-level percentage rollout.

## Condition operators

`satisfies()` in the engine decides one condition against one subject.

| Operator                                        | True when                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| `equals`                                        | The attribute is defined and `String(attribute)` equals `values[0]`.                     |
| `not_equals`                                    | The attribute is missing, or `String(attribute)` differs from `values[0]`.               |
| `contains`                                      | The attribute is defined and at least one value is a substring of `String(attribute)`.   |
| `not_contains`                                  | The attribute is missing, or no value is a substring of `String(attribute)`.             |
| `in`                                            | The attribute is defined and at least one value stringifies equal to `String(attribute)`. |
| `not_in`                                        | The attribute is missing, or no value stringifies equal to `String(attribute)`.          |
| `greater_than`                                  | Both sides coerce to a number and the attribute's number is greater.                     |
| `greater_than_or_equal`                         | Both sides coerce to a number and the attribute's number is greater or equal.            |
| `less_than`                                     | Both sides coerce to a number and the attribute's number is less.                        |
| `less_than_or_equal`                            | Both sides coerce to a number and the attribute's number is less or equal.               |
| `matches_regex`                                 | The attribute is defined and `values[0]` as a `RegExp` tests true against `String(attribute)`. |

Coercion details, all from `satisfies()` and its helpers:

- `equals`, `not_equals`, `contains`, `not_contains` and `matches_regex` compare against `String(attribute)`; only the subject side is coerced. `condition.values` is a `string[]`, normalised by the repository's `toValues`, which maps each array entry through `String`, turns a non-array non-null value into a one-element array, and turns `null` into `[]`.
- `in` and `not_in` stringify both sides through `includesValue`.
- The numeric operators go through `toNumber`: a number passes through, a non-empty trimmed string is parsed with `Number`, and `NaN` becomes `null`. Booleans, `undefined`, empty strings and whitespace-only strings all become `null`. When either side is `null` the condition is false, so a numeric comparison against a missing or boolean attribute is false.
- A missing attribute is false for `equals`, `contains`, `in`, the four numeric operators and `matches_regex`; the negation operators (`not_equals`, `not_contains`, `not_in`) treat it as a match.
- `matches_regex` constructs `new RegExp(condition.values[0] ?? "")` inside a `try`; an invalid pattern is caught and returns false, so it matches nothing rather than failing the request.
- Any operator outside the table hits the `default` branch and returns false. The operator field is free text (`targeting_conditions.operator` and `segment_conditions.operator` are text columns), so an unknown operator matches nothing.
- `attributeType` is carried on every condition row and on `EvaluationCondition`, but `satisfies()` never reads it: behaviour is driven by the operator alone.

## Bucketing

`bucketFor(flagKey, value)` in the engine is the whole algorithm.

```text
bucketFor(flagKey, value) = readUInt32BE(sha256(`${flagKey}:v1:${value}`), 0) % 100
```

The middle segment is `EVALUATION_HASH_VERSION`, defined as `"v1"` in `packages/engine/src/types.ts`. The digest's first four bytes are read as an unsigned 32-bit big-endian integer, then reduced modulo 100, so a bucket is 0 through 99. The flag key is inside the hash input so that two flags at 10% do not select the same users, and the version segment makes the algorithm versionable.

This input is frozen. Changing the hash input, its separators or the version reshuffles everyone already bucketed, which is a one-way-door change: users who saw a variation under the old input can move to the other side, so the version constant carries the version rather than being edited in place.

The hashed value is chosen by `bucketValue(subject, bucketBy)`: the subject's attribute named by `bucketBy`, stringified, falling back to `subject.id` when that attribute is `undefined`. Attribute lookup comes first, so the subject id is a fallback and not an additional input.

## The flag-level rollout endpoints

Both endpoints are ordinary thresholds, so the branch in `packages/engine/src/evaluate.ts` is guarded by `percentage < 100` alone. `0` sends every subject to `config.offVariation` — with `enabled` therefore false, since `serve` derives it from the served variation — and `100` serves `config.defaultVariation` to everyone with reason `default_variation`. The rule-level rollout reaches the same conclusion from the other side: it branches on `rule.rolloutPercentage !== null` and handles `0` by never applying the rule.

An earlier revision skipped the bucket at both endpoints, which made an enabled flag at `0%` serve the default variation to everyone. That is fixed; the behaviour is now what the percentage says. Note the consequence for stored configuration: a flag left `enabled` at `0%` serves nobody, so enabling a flag and setting its rollout are separate decisions.

## The evaluation API

`POST /v1/evaluate`. The route is declared in `evaluation.routes.ts` and mounted at `/` in `app.ts`, so the path sits outside any project path.

An example request body:

```json
{ "flag": "checkout-v2", "environment": "production", "projectKey": "beta", "user": { "id": "user-42", "plan": "pro", "age": 34 } }
```

An example response:

```json
{ "flag": "checkout-v2", "enabled": true, "variation": "on", "reason": "percentage_rollout", "matchedRuleId": null }
```

| Field           | Shape                                                                          | Notes                                                                                 |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `flag`          | string, at least one character                                                  | Required.                                                                             |
| `environment`   | string, at least one character                                                  | Required.                                                                             |
| `projectKey`    | string                                                                          | Optional.                                                                             |
| `user`          | object with a required `id` string plus any string, number or boolean attribute | The attributes conditions and `bucketBy` read.                                         |
| `enabled`       | boolean                                                                         | True when the served variation differs from the off variation.                          |
| `variation`     | string                                                                          | A variation key, not a variation value.                                                |
| `reason`        | `EVALUATION_REASONS`                                                            | The vocabulary in "Evaluation reasons" above.                                          |
| `matchedRuleId` | string or null, optional in the contract                                        | The id of the rule that served; `null` at every other step.                            |

`projectKey` is optional because the SDK only knows its own key, while the dashboard may send it to disambiguate: the same flag and environment keys can exist in two projects of one workspace. The repository adds the project key to the lookup when it is present and otherwise takes the lowest project key.

`enabled` is a property of the decision rather than of the flag's `enabled` column. The engine's `serve` helper computes it as `variation !== config.offVariation`, so an archived or disabled flag reports `enabled` false because it serves the off variation. `matchedRuleId` is the id of the targeting rule that served and is `null` for an individual target, the percentage rollout, the default variation and every service-level outcome.

The controller parses the body with `evaluateRequestSchema.safeParse`; malformed JSON and schema failures both answer 400 with the first issue's message, in the envelope described in `docs/api-conventions.md`.

The endpoint currently requires a session. `evaluation.routes.ts` applies the session middleware to every route and the controller calls `requireWorkspace(c)`, which throws `unauthorized` when there is no session. That is deliberate: `/v1/evaluate` is the dashboard's explainer, and the SDK-facing path is `GET /v1/sdk/config`, which takes a read-only runtime key and lets the SDK decide locally (`docs/sdk.md`). The flag detail's Preview tab is the dashboard caller: it sends the flag, the environment and a subject, and renders the variation, the reason and the rule that served. The response carries no per-condition result, so that tab restates the matched rule's stored requirements instead of inferring which condition passed. The evaluation is scoped to the workspace taken from that session, not from the body; the tenancy rules are in `docs/architecture.md §2`.

## How rows are loaded

`EvaluationRepository.findTarget(organizationId, lookup)` loads everything the engine needs, scoped to one workspace: the flag's identity by project and flag key, then that flag's configuration in the named environment.

The lookup resolves the flag by `projects.organization_id` from the session, `flags.key` and `environments.key`, plus `projects.key` when it was supplied, ordered by `projects.key` ascending with a limit of one, and joins `flag_environment_configs` on `(flag_id, environment_id)`. No row, or a missing configuration, is `null`. The joined row supplies the flag status and the configuration the engine receives: `enabled`, `off_variation_key`, `default_variation_key`, `rollout_percentage` and `bucket_by`.

The follow-up queries are keyed by ids from that row:

- `targeting_rules` for the flag and environment, ordered by `priority` ascending. Each rule contributes its `variation_key`, `segment_keys`, `rollout_percentage` and `bucket_by`.
- `targeting_conditions` for those rules, ordered by `priority` ascending and then by id, then grouped back onto their rule by `rule_id`.
- `flag_individual_targets` for the flag and environment, every row, in no particular order.
- `segments` for the flag's project, restricted to the deduplicated segment keys the loaded rules reference. There is no archived filter, so an archived segment still resolves; the source states that a hidden segment must not silently change what a flag serves.
- `segment_conditions` for those segments, ordered by `priority` ascending and then by id, then grouped by `segment_id`.

Condition values arrive from `jsonb` and are normalised by the repository's `toValues`. `flag_variations` does not contribute: evaluation returns variation keys and never resolves them to values. The configuration always comes from the resolved `flag_environment_configs` row, and no cache sits in front of the query, so every evaluation reads PostgreSQL.

## Status

Built: the pure engine with its full resolution order; the seven reasons the code actually produces; bucketing with the frozen `v1` input; `POST /v1/evaluate` behind a session; the repository queries that assemble an evaluation input; and the `GET /v1/sdk/config` snapshot with its runtime-key authentication (`docs/sdk.md`).

Partial: the `error` reason is in the contract vocabulary but has no producer, and evaluation failures surface as a generic 500 through `app.onError`.

Not built: the Redis configuration cache that would feed evaluation later (`docs/architecture.md §8.1`); evaluation reads the database on every request.

## Where it lives

- `packages/engine/src/evaluate.ts` — the pure `evaluate` function and `satisfies`.
- `packages/engine/src/bucket.ts` — `bucketFor`, the frozen bucketing hash.
- `packages/engine/src/sha256.ts` — the SHA-256 the bucket hashes with, and the UTF-8 encoder it reads.
- `packages/engine/src/types.ts` — engine input and outcome types, the hash version and the off variation.
- `packages/engine/src/snapshot.ts` — the snapshot adapter an SDK evaluates from (`evaluateSnapshot`, `servedValue`, `toSubject`).
- `apps/api/src/modules/evaluation/evaluation.service.ts` — resolves the row set and returns `flag_not_found`.
- `apps/api/src/modules/evaluation/evaluation.repository.ts` — loads the rows that form an evaluation input.
- `apps/api/src/modules/evaluation/evaluation.controller.ts` — session context, body validation and the response.
- `apps/api/src/modules/evaluation/evaluation.routes.ts` — mounts `POST /v1/evaluate` behind the session middleware.
- `apps/api/src/modules/evaluation/index.ts` — the module's exports.
- `packages/contracts/src/evaluation.ts` — the request and response schemas and `EVALUATION_REASONS`.
- `apps/api/src/db/schema/flags.ts` — the flag's identity row.
- `apps/api/src/db/schema/flag-environment-configs.ts` — the per-environment configuration the engine receives.
- `apps/api/src/db/schema/targeting-rules.ts` — ordered rules with their variation, segment keys and rollout.
- `apps/api/src/db/schema/targeting-conditions.ts` — the conditions a rule ANDs.
- `apps/api/src/db/schema/flag-individual-targets.ts` — per-user variation overrides.
- `apps/api/src/db/schema/segments.ts` — project-scoped segments, archived rather than deleted.
- `apps/api/src/db/schema/segment-conditions.ts` — the conditions a segment ANDs.
- `apps/api/src/db/schema/flag-variations.ts` — variation definitions, not read during evaluation.
- `apps/api/src/middleware/authorization.ts` — the session and workspace requirement.
- `apps/api/src/app.ts` — route mounting, `notFound` and the `onError` boundary.
- `apps/api/src/shared/http/errors.ts` — the error envelope and the generic 500.
- `packages/engine/src/engine.test.ts` — direct unit tests of `evaluate` and `bucketFor`.
- `packages/engine/src/conformance.test.ts` — the committed cross-language corpus still matches the engine.
