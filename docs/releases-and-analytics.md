# Releases and analytics

## Version history

`GET /v1/projects/:projectKey/flags/:flagKey/environments/:environmentKey/versions/:version`
returns the history summary plus `state`, containing `config`, `rules`, and `targets`.
`state: null` identifies older entries whose snapshots cannot be restored.

`POST .../versions/:version/restore` restores these three parts atomically, writes an audit event,
and creates a new version. It requires engineer access. Protected environments return
`409 approval_required`; submit the saved state as a change request for a second person to approve.
Restoration validates current variation and segment references. It does not restore their definitions.

## Scheduled changes

`GET .../schedules` uses the standard cursor pagination contract.
`POST .../schedules` accepts `{ executeAt, baseVersion, payload }`, with a UTC or offset ISO timestamp
between one minute and one year ahead. The payload has the same optional configuration/rules/targets
parts as a change request. `DELETE .../schedules/:id` cancels a pending change.

Schedules require engineer access and an unprotected environment. Workers claim due rows using
`FOR UPDATE SKIP LOCKED`; configuration changes and completion status commit together. Removing the
creator's membership, reducing permissions, protecting the environment, removing referenced resources,
or publishing another version prevents execution. Failed schedules expose a safe reason in history.
Run the API server process to execute schedules; the listener-free test app does not start workers.

## Browser delivery

Project admins opt flags in using `PATCH /v1/projects/:projectKey/flags/:flagKey/client-visibility`
with `{ clientVisible: true }`. Flags default to private.

An environment-scoped client key calls `POST /v1/sdk/evaluate` with
`{ user: { id: "subject", country: "NG" }, flags: ["banner"] }`. The result is
`{ flags: { banner: { value: true, enabled: true } } }`. Private and missing flags are omitted.
Rules, alternate values, segment definitions, matched-rule identifiers, and individual targets are
never returned. Responses are not cacheable. Regex conditions are unsupported on this public surface.
Client-supplied identities are untrusted; these values must not authorize access to protected resources.

## Evaluation analytics

Server keys with `events:write` call `POST /v1/sdk/events` with up to 100 events. Each event has
`{ id, flagKey, variation, reason, latencyMs, userId? }`. Use a UUID for `id`; retrying an accepted event
does not count it twice. Subject identifiers are HMAC hashed with an environment namespace before
storage. User attributes are never stored. Event time is the API's receipt time.

`GET /v1/analytics?days=7&projectKey=checkout` returns received-event totals, distinct subjects,
reported errors, average/p95 evaluation latency, daily counts, top flags, and environment totals.
The optional project filter is authorized against current membership. Workspace totals include only
projects visible to the caller. Unique subjects are counted separately per environment.

Enable reporting with `new FeatureFlags({ sdkKey, baseUrl, telemetry: true })`. Reporting defaults off.
The SDK buffers up to 1,000 events and sends batches of 100 every ten seconds. Temporary failures
retry using the same event IDs. Reporting errors reach `onError`; they never throw from flag getters.
`await flags.flush()` sends one buffered batch. Flush before `flags.close()`, which stops timers and
discards pending events. Analytics are best-effort received-event counts, not a billing meter.

The API's hourly cleanup removes evaluation and audit records older than 90 days. No production
migration or cleanup process is started by generating migrations or running the test app.

## Two-factor authentication

Security settings support authenticator enrollment and recovery-code replacement through Better Auth.
Secrets and recovery codes are encrypted under the deployment secret. Enrollment requires confirming
a TOTP code; recovery codes are single-use. Verification marks the resulting session and revokes other
sessions. Existing and social-login sessions must also verify a factor before accessing versioned APIs.

A workspace owner or admin must enroll before requiring two-factor authentication for members.
Members without enrollment are restricted to enrollment and sign-out until they finish. A required
factor cannot be disabled through the authentication API. Keep recovery codes outside the application.

## Lifecycle and streaming

Project owners can archive, restore or duplicate a project using `POST /v1/projects/:key/archive`,
`restore` or `duplicate`. Duplication accepts `{ name }`. `GET /v1/projects?includeArchived=true`
includes recoverable archives. Archived projects are hidden from normal resource access and SDK
authentication. Archiving revokes all keys and cancels armed rollback policies, schedules and approvals.
Restoring data does not reactivate those credentials or jobs.

`POST /v1/projects/:key/transfer` accepts `{ destinationWorkspaceSlug }`. The caller must own both
workspaces. Transfer creates an independent destination copy and archives the source; it preserves the
original history in the source workspace instead of changing tenant IDs underneath in-flight requests.
Copies include environments, variations, targeting, segments and dependencies; flags start disabled
and browser-private. Memberships, credentials, old history, metrics, schedules and policies are excluded.
Each copied environment starts with a complete version-one snapshot. The destination's project key may
receive a suffix. Switch workspaces through Better Auth's authorized active-organization endpoint.

`GET /v1/sdk/stream` accepts server keys with flags:read and returns SSE configuration-version
notifications and heartbeats. It sends no targeting data, revalidates credentials every 15 seconds,
limits connections to three per key and 100 per process, and closes streams after five minutes.
The Node SDK's `streaming: true` reconnects automatically and uses polling as a fallback. Rejecting
a key clears the SDK's cached configuration on the next refresh or revocation event. Older SDK
versions or applications that disable both refresh mechanisms may retain their own cached data.

## Notifications and automatic rollback

`GET /v1/notifications` returns a cursor-paginated inbox and unread count for currently visible projects.
`POST /v1/notifications/:id/read` records read state for the current user only. The inbox uses retained
audit events, including approval decisions, failed schedules, project lifecycle actions and triggered
rollbacks. These are in-app notifications; no email or external delivery is enabled.

`POST .../environments/:environmentKey/rollback-policies` accepts `{ currentVersion, targetVersion,
errorPercentage, minimumSamples, windowMinutes, expiresAt? }`. Monitoring expires after one hour by
default and at most 24 hours. The target must be an earlier complete snapshot, the minimum sample
size is ten, and the observation window is one to 60 minutes. The GET endpoint is paginated; DELETE
`.../rollback-policies/:id` cancels an armed policy.

Monitoring is opt-in for unprotected environments and requires a server key with events:write to report
application outcomes. Capture the decision before performing application work:

```ts
const decision = flags.evaluate("new-checkout", context);
// Perform the application operation using decision.enabled or decision.value.
flags.trackOutcome(decision, operationSucceeded, context);
```

The receipt preserves the evaluated release version even if a refresh happens before reporting.
Only outcome events for that version, received after arming and within the observation window, count.
Ordinary evaluation events and outcomes from earlier versions cannot trigger rollback. Telemetry is
trusted input from server keys; protect keys that can report outcomes for an armed policy.

Workers claim policies with row locks, require the minimum sample size and configured error threshold,
and recheck project access, creator membership, protection and current release version. A later publish
blocks the policy. Restoring configuration/rules/targets, writing history and marking the policy
triggered commit in one transaction. Variation values and segment definitions are not reverted.
The analytics dashboard counts evaluation events separately so outcomes do not inflate evaluation totals.

## Standalone Node SDK artifact

`pnpm --filter @iwifunni-flag/core test:package` builds a tarball and installs it in an isolated temporary
consumer, checking runtime imports and TypeScript declarations without workspace dependencies.
`pnpm --filter @iwifunni-flag/core package` creates the distributable in `packages/sdk-node/dist`.
The workspace package remains private; publication uses the generated distribution manifest and
requires a selected registry and working publisher authentication. No package has been published.
