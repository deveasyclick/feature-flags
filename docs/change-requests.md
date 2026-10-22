# Change requests

A change request is how a flag change reaches a protected environment: an engineer proposes it, a
different project admin approves or rejects it, and an approved change is applied in the same
database transaction as the decision. Flag semantics belong to `docs/flags.md`, the role matrix to
`docs/authorization.md`, the error and pagination shapes to `docs/api-conventions.md`, the table
inventory to `docs/domain-model.md`; the decision is `docs/architecture.md §4`, the enforcement rule
§3, the transaction and audit commitment §6.

## What a protected environment changes

`isProtected` is a boolean on the environment and the only representation of this state —
there is no settings bag mirroring it. A project admin toggles it through
`PATCH /v1/projects/:projectKey/environments/:environmentKey/settings` with
`{ "isProtected": true }`, audited as `environment.updated`. A project's starter environments are
created unprotected, so protection is always an explicit choice.

Every direct publish into a protected environment is refused by `FlagsService.assertPublishable`.
The three environment-scoped writes — the configuration publish, the rules and the targets,
all under `/v1/projects/:projectKey/flags/:flagKey/environments/:environmentKey` — check
`scope.environment`. Reads and flag identity edits are not gated. Shared variation values and flag archive/restore operations are blocked while an active environment in the project is protected. Segment condition changes are blocked when a protected environment references that segment. Create a new variation or segment, then approve its selection through an environment change request.

The refusal is `ApiError.approvalRequired(environment.key)` — HTTP 409, code `approval_required`,
with the environment key as the extra detail:

```json
{
  "error": {
    "code": "approval_required",
    "message": "\"production\" is a protected environment. Propose the change for approval instead of publishing it directly.",
    "details": { "environmentKey": "production" }
  }
}
```

`approval_required` is a member of the `ERROR_CODE` vocabulary. It carries its own code so a client
can branch on it and offer the approval flow rather than show a conflict the user cannot act on.

## The routes

All four are mounted at `/v1/projects`, addressed under the flag the request proposes to change.

| Method | Path | What it does | Minimum project role |
| --- | --- | --- | --- |
| `GET` | `/v1/projects/:projectKey/flags/:flagKey/change-requests` | Lists the flag's change requests | viewer |
| `POST` | `/v1/projects/:projectKey/flags/:flagKey/change-requests` | Proposes a change; answers `201` | engineer |
| `POST` | `/v1/projects/:projectKey/flags/:flagKey/change-requests/:requestId/approve` | Approves and applies the change | admin |
| `POST` | `/v1/projects/:projectKey/flags/:flagKey/change-requests/:requestId/reject` | Rejects the change | admin |

`list` requires `viewer`, `create` requires `engineer`, and both decisions call `requireDecidable`,
which requires `admin`; an owner outranks admin and also decides. A decision body is optional —
`{ "note": string | null }`, trimmed, at most 280 characters — and an empty body is a decision with
no note. A request whose flag is not the one in the path answers 404.

## The proposal payload

A proposal is `{ environmentKey, payload }`, and it targets one flag's configuration in one
environment. The payload carries up to three parts, each in the shape the corresponding direct
write endpoint takes:

| Field | Contract schema | Proposes |
| --- | --- | --- |
| `config` | `updateFlagConfigSchema` | `enabled`, `offVariation`, `defaultVariation`, `rolloutPercentage`, `bucketBy` |
| `rules` | `replaceTargetingRulesSchema` | The environment's ordered targeting rules, replaced whole |
| `targets` | `replaceIndividualTargetsSchema` | The environment's individual targets, replaced whole |

All three are optional, and a proposal must carry at least one: `proposeFlagChangeSchema` rejects a
payload with none of them as "A change request must propose a change.", surfacing as
`400 invalid_request`. Approving applies only the parts present, so a configuration proposal cannot
clear the targeting state and a targeting proposal cannot clear the configuration. Inner shapes live
in `packages/contracts` and are described in `docs/flags.md`.

The stored payload is `jsonb`, validated again as it crosses out of the database:
`parseChangePayload` returns `null` for a row written under an older contract. A listing reports such
a row as `payload: {}`, and approving it is refused with `409 conflict` ("This change request can no
longer be read, so it cannot be approved. Reject it and propose the change again.").

## Validation happens at create time, not at approval time

`create` calls the injected applier's `validate` before anything is written, so that "a reviewer is
never asked to approve a change the API would reject anyway". The flags module's
`validateProposedChange` documents the same rule: it "checks a proposed change without writing it,
so an invalid proposal is refused when it is made rather than when somebody is asked to approve
it."

Both `validate` and `apply` resolve through `FlagsService.resolveApprovedChange`, which re-checks
the project gate at `engineer` and runs the same per-part validations as the direct endpoints
(`validateConfigInput`, `validateRules`, `validateTargets`). A proposal changes nothing until it is
approved.

## One pending request per flag and environment

A flag has at most one pending request per environment. `create` calls
`ChangeRequestsRepository.supersedePending(tx, flagId, environmentId)` in the same transaction as
the insert: every pending row for that flag and environment moves to status `superseded` and its
`updatedAt` is bumped. A newer proposal replaces the older pending one instead of queueing behind
it, and the superseded row is kept and stays listable with `?status=superseded`.

The guarantee behind that is the partial unique index `flag_change_request_pending_idx` on
`(flag_id, environment_id)` where `status = 'pending'`: the repository comment calls the index the
real guarantee and describes `supersedePending` as making the replacement explicit rather than a
write that fails on the index.

## The decision rules

Both decisions go through `ChangeRequestsService.requireDecidable`, which requires, in order: the
project gate at `admin`, a flag that exists in the project and matches the path, a request that is
still `pending` (otherwise `409 conflict`), and a caller who is not the request's author — otherwise
`403 forbidden`:

> A change request must be approved by somebody other than the person who proposed it.

The self-decision bar applies to rejection too, because both paths share `requireDecidable`. The
service class comment says both rules are "enforced here rather than in the dashboard, because a
client that skipped the screen would otherwise approve its own change".

Listing computes `canDecide` per row so a dashboard can hide a button the API would refuse:
`status === "pending" && requestedBy !== caller && PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK.admin`.
`canDecide` is presentation data; the API remains the enforcement point.

## Atomicity

`approve` runs one `db.transaction`. Inside it, `ChangeRequestsRepository.decide` moves the row out
of `pending` with an `UPDATE ... WHERE status = 'pending'` and reports whether it won; a second
reviewer deciding the same request changes nothing and gets `409 conflict` ("That change request has
already been decided."). Only then does the applier `apply` the change on `tx`, and `writeAuditLog`
records the decision on `tx` too: "the approval and the change it authorises commit together — a
change whose request is still pending must never be visible". `create` uses the same
pattern for supersede, insert and audit; the audit-row rule is `docs/architecture.md §6`.

## Who performs the applied change

The change-requests module authorises the change; the flags module performs it. Neither imports the
other. `app.ts` constructs `ChangeRequestsService` with an inline `ChangeApplier`:

```ts
validate: (actor, change) => flagsService.validateProposedChange(...)
apply:    (tx, actor, change) => flagsService.publishApprovedChange(tx, ...)
```

`validate` only answers whether the proposal is valid. `apply` takes the caller's transaction and
writes the change: `publishApprovedChange` resolves the scope again at `engineer`, then publishes
`config`, `rules` and `targets` — only the parts present — through the same private helpers the
direct endpoints use, recording flag versions along the way. It deliberately does not call
`assertPublishable`, because the protected gate must not refuse the write it just authorised. It is
not reachable over HTTP, so no route can bypass the gate.

## The audit trail

Each transition writes one audit row through `writeAuditLog(tx, ...)`, with `target` set to the
request id, the environment id, and the actor and organization from the session.

| Action | Written when | `changes` |
| --- | --- | --- |
| `change_request.created` | A proposal is stored | `flagKey`, `environment`, `parts` |
| `change_request.approved` | A request is approved and applied | `flagKey`, `environment`, `requestedBy`, `parts` |
| `change_request.rejected` | A request is rejected | `flagKey`, `environment`, `requestedBy`, `note` |

`parts` lists the payload parts the proposal touches, drawn from `config`, `rules` and `targets`;
`requestedBy` is the author's user id. The change also writes its own flag audit rows
(`flag.enabled`, `flag.disabled`, `rollout.updated`, `flag.updated`) and a flag version through the
flags module. The event vocabulary and the table are in `docs/domain-model.md`.

## Listing and filters

`GET .../change-requests` accepts the pagination query plus two filters.

| Parameter | Values | Notes |
| --- | --- | --- |
| `limit` | 1–100 | Defaults to 50 |
| `cursor` | opaque string | Taken from the previous response's `nextCursor` |
| `environmentKey` | resource key | Matches the environment's key |
| `status` | `pending`, `approved`, `rejected`, `superseded` | Omitted means every status |

The response is `{ data, nextCursor }`; rows are newest first by `createdAt`, then `id`. Each row is
a `FlagChangeRequest`: `id`, `projectId`, `flagId`, `flagKey`, `environmentId`, `environmentKey`,
`environmentName`, `status`, `payload`, `requestedBy`, `requestedByName`, `requestedAt`,
`decidedBy`, `decidedByName`, `decidedAt`, `decisionNote`, `canDecide`.

The cursor is not the base64url form `shared/pagination.ts` produces for other list endpoints:
`encodeChangeCursor` builds `createdAt.toISOString() + "::" + id`, so two requests sharing a
timestamp cannot make a timestamp-only cursor skip or repeat a row. A cursor that cannot be decoded
is ignored — the request returns the first page rather than a 400. The generic pagination and error
shapes are `docs/api-conventions.md`.

## Status

- The gate, the four routes, the payload contract, supersede-on-create, create-time validation, the
  shared decision path with the self-approval bar, and the single-transaction apply all exist and are
  covered by `apps/api/src/test/modules/change-requests.test.ts`.
- The dashboard has a client (`changeRequests` in `apps/web/lib/api.ts`) and an approval panel
  (`FlagApprovalPanel`) that reads `canDecide`; dashboard screens are `apps/web/README.md`.
- `ChangeRequestsRepository.findPending` exists but has no caller; the single-pending guarantee is
  `supersedePending` plus the partial unique index.
- A pending request has no expiry: `supersedePending` and `decide` are the only writers of
  `flag_change_requests.status` in the API, so a request leaves `pending` only when a newer proposal
  supersedes it or somebody decides it.

## Where it lives

- `apps/api/src/modules/change-requests/change-requests.routes.ts` — the four routes.
- `apps/api/src/modules/change-requests/change-requests.controller.ts` — input parsing and the actor context.
- `apps/api/src/modules/change-requests/change-requests.service.ts` — authorisation, supersede, decision, transaction, audit.
- `apps/api/src/modules/change-requests/change-requests.repository.ts` — queries, `supersedePending`, race-safe `decide`.
- `apps/api/src/modules/change-requests/change-requests.mapper.ts` — payload parsing on read and the response shape.
- `apps/api/src/modules/change-requests/change-requests.types.ts` — rows, filters, cursor and the `ChangeApplier` port.
- `apps/api/src/modules/change-requests/index.ts` — module exports.
- `packages/contracts/src/change-request.ts` — the wire contract for proposals, decisions and listing.
- `apps/api/src/db/schema/flag-change-requests.ts` — the table and the partial pending index.
- `apps/api/src/modules/flags/flags.service.ts` — `assertPublishable`, `validateProposedChange`, `publishApprovedChange`.
- `apps/api/src/db/audit.ts` — `writeAuditLog`, called with the mutation's transaction.
- `apps/api/src/shared/http/errors.ts` — `ApiError.approvalRequired`.
- `apps/api/src/app.ts` — the injected applier that joins the two modules.
