# Authorization

Who may act on which resource, in which tenant. `docs/architecture.md §3` holds the
decision; this document holds the detail: role vocabularies, the rank order, the operation
matrix and the mechanics of the gate.

## Two role vocabularies

| Vocabulary | Values                                 | Stored on                                           |
| ---------- | -------------------------------------- | --------------------------------------------------- |
| Workspace  | `owner`, `admin`, `member`             | `member.role`, the caller's organization membership |
| Project    | `owner`, `admin`, `engineer`, `viewer` | `project_members.role`                              |

The two sets share two names and nothing else: a workspace `admin` and a project `admin`
are separate facts. The workspace role reaches a request as `context.workspace.role` and is
passed on as `workspaceRole`; the project vocabulary is the Zod enum `PROJECT_ROLES` in
`packages/contracts/src/project-member.ts`, and every wire value, including
`addProjectMemberSchema` and `updateProjectMemberSchema`, is parsed against it. Tenancy
tree: `docs/domain-model.md`. How a session becomes `context.workspace`:
`docs/authentication.md`.

## Project role rank

`PROJECT_ROLE_RANK` in `project-access.types.ts` is the only ordering:

```ts
export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  engineer: 1,
  admin: 2,
  owner: 3,
};
```

Two helpers sit beside it. `isProjectRole(value)` is true only for a non-null key of the
rank map, which narrows a plain database `role` string to `ProjectRole`.
`highestRole(first, second)` returns the higher-ranked role, passing through whichever side
is non-null, and `null` when both are.

## The access gate

`ProjectAccessService.require` is the single gate for project-scoped work. It takes
`organizationId`, `projectKey`, `userId`, the caller's `workspaceRole` and a `minimumRole`,
then:

1. Resolves the project by `(organizationId, projectKey)`; no row → `404`.
2. Reads the caller's explicit `project_members` row for that project.
3. Combines the explicit role with the implicit workspace role through `highestRole`.
4. No role at all → `404`; a role below `minimumRole` → `403`.

A caller who is not a member cannot tell a project that does not exist from one in another
tenant: both answer `404`, which is what stops project enumeration. Only a caller who can
already see the project is told their rank is too low.

### The implicit-admin rule

A workspace `owner` or `admin` administers every project in the workspace without a
`project_members` row. `ProjectAccessService.implicitRole` maps workspace `owner` to
project `owner`, workspace `admin` to project `admin`, and everything else, `member`
included, to `null`. The effective role is `highestRole(implicit, explicit)`, and
`ProjectAccessGrant.role` is that value, never the explicit row alone. The rule lives
inside `require`, so every gated service inherits it. Project `owner` is the top of the same
ladder, and only updating a project compares against it.

## Operation by role

The minimum role is the argument each call site passes to the gate.

| Operation                                                                                                 | Minimum project role                         |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Read a project                                                                                            | `viewer`                                     |
| Read flags, one flag, one environment's configuration, variations, rules, targets, dependencies, versions | `viewer`                                     |
| Create or update a flag; add, edit or remove variations; publish configuration; replace rules/targets     | `engineer`                                   |
| Archive or unarchive a flag                                                                               | `engineer`                                   |
| List or read segments                                                                                     | `viewer`                                     |
| Create, update or archive a segment                                                                       | `engineer`                                   |
| List or read environments                                                                                 | `viewer`                                     |
| Create, edit, archive or unarchive an environment                                                         | `admin`                                      |
| List SDK keys                                                                                             | `viewer`                                     |
| Issue or revoke an SDK key                                                                                | `admin`                                      |
| List project members                                                                                      | `viewer`                                     |
| Add, re-role or remove a project member                                                                   | `admin`                                      |
| Rename or reconfigure a project                                                                           | `owner`                                      |
| Archive a project                                                                                         | not built: no route or service method exists |
| List a flag's change requests                                                                             | `viewer`                                     |
| Propose a change request                                                                                  | `engineer`                                   |
| Approve or reject a change request                                                                        | `admin`, and not the author                  |
| Read the project audit log                                                                                | `viewer`                                     |

Environment editing covers `create`, `update`, `updateSettings`, `archive` and `unarchive`, all at `"admin"`.

Workspace-wide project, flag, audit-log lists and evaluation filter by the caller's current project memberships. Workspace owners and admins retain visibility across the workspace. A member without project access receives no project data from these surfaces, and evaluation returns `flag_not_found`. Creating a project makes the creator its explicit owner in the same transaction.

## Enforcement mechanics

- The session is resolved once by the session middleware and stored on the request context.
  Controllers read `requireWorkspace(c)` and build the service actor context from
  `context.workspace.id`, `context.workspace.role`, `context.user.id` and
  `context.user.name`; they never call Better Auth directly.
- Authorization is enforced at the route boundary through the gate, and each service method
  calls `projectAccess.require` before touching its repository, so a route added later
  still meets the gate inside the service.
- Membership is read from `project_members` on every request. No project role is carried in
  a token or session claim, so removing a member takes effect on the next request.

## Tenant isolation

`organizationId` comes from the session and is never read from a body, a query parameter or
a path segment. The gate scopes its project lookup by `organizationId` before it considers
membership, and the workspace-scoped lists carry the same id into their repository calls. A
cross-tenant read answers **404**, not 403: a 403 confirms the resource exists and enables
enumeration, so it is the decision at `docs/architecture.md §3`.

## Workspace-level gates

`requireSession` needs a session and answers `401` without one. `requireWorkspace` needs
that session to resolve to a workspace and answers `404 "No workspace found for this
account."` otherwise. Reading the workspace profile and security settings needs only
`requireWorkspace`: any member may read them. Changing either goes through
`WorkspaceService.assertCanManage`, which allows workspace `owner` and `admin` and throws
`403` otherwise (`MANAGING_ROLES` in `workspace.service.ts`).

## Protected environments

An environment is protected when `environment.is_protected` is true. Marking it is an environment
settings write — `PATCH .../environments/:environmentKey/settings` with `{ "isProtected": true }` —
so it needs project `admin`.

A direct publish into a protected environment is refused. `FlagsService.assertPublishable`
throws `ApiError.approvalRequired` — `409`, code `approvalRequired`, carrying the
environment key — for flag configuration, targeting rules and individual targets in that
environment, so the change must go through approval instead. The workflow itself
is `docs/change-requests.md`; one rule belongs here: deciding a request needs project
`admin` and a caller other than the person who proposed it, enforced in
`ChangeRequestsService.requireDecidable`. An approved change re-enters through
`FlagsService.publishApprovedChange` inside the deciding transaction.

## Status

- Workspace roles, project roles, the rank map and both helpers: exists.
- The access gate, the implicit-admin rule and the 404-for-invisible behaviour: exists.
- Every operation in the matrix above: exists, except archive a project, which has no
  route, service method or schema (`docs/architecture.md §9`).
- Workspace-level owner/admin checks, protected environments requiring a non-author
  approver, and membership resolved per request rather than from a claim: exists.

## Where it lives

- `apps/api/src/modules/project-access/project-access.service.ts` — the gate and the implicit-admin rule.
- `apps/api/src/modules/project-access/project-access.repository.ts` — tenant-scoped project lookup and membership read.
- `apps/api/src/modules/project-access/project-access.types.ts` — `PROJECT_ROLE_RANK`, `isProjectRole`, `highestRole`, the gate's input and result types.
- `apps/api/src/middleware/authorization.ts` — session resolution, `requireSession`, `requireWorkspace`.
- `apps/api/src/modules/auth/auth.types.ts` — `RequestContext` and `WorkspaceMembership`, the `role` the gate reads.
- `apps/api/src/modules/workspace/workspace.service.ts` — workspace-level owner/admin checks for profile and security.
- `apps/api/src/modules/projects/projects.service.ts` — project read at `viewer`, project update at `owner`.
- `apps/api/src/modules/flags/flags.service.ts` — flag reads at `viewer`, flag writes at `engineer`, `assertPublishable`.
- `apps/api/src/modules/segments/segments.service.ts` — segment reads at `viewer`, segment writes at `engineer`.
- `apps/api/src/modules/environments/environments.service.ts` — environment reads at `viewer`, environment management at `admin`.
- `apps/api/src/modules/api-keys/api-keys.service.ts` — key listing at `viewer`, issuing and revoking at `admin`.
- `apps/api/src/modules/project-members/project-members.service.ts` — membership listing at `viewer`, management at `admin`.
- `apps/api/src/modules/change-requests/change-requests.service.ts` — proposing at `engineer`, deciding at `admin` by a non-author.
- `apps/api/src/modules/audit-log/audit-log.service.ts` — project audit reads at `viewer`, workspace audit reads at session scope.
- `packages/contracts/src/project-member.ts` — `PROJECT_ROLES` and the project member schemas.
- `apps/api/src/db/schema/member.ts` and `apps/api/src/db/schema/project-members.ts` — where the two role columns live.
