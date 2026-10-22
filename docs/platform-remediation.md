# Platform remediation

This records the review scope and remaining product work. Completed implementation is subject to the repository validation gate.

## Security and production foundation

- Server-only configuration snapshots; browser keys cannot download targeting data.
- Workspace-wide reads and evaluation respect current project membership.
- Session duration is a maximum age measured from sign-in, enforced on versioned and authentication routes. Password changes revoke other sessions.
- Authenticator enrollment, encrypted recovery codes, second-factor session verification and workspace enforcement are implemented. Verifying a factor revokes other sessions. SSO, domain restrictions, IP allowlists and retention changes remain unavailable.
- Shared flag lifecycle/value edits and referenced segment changes cannot bypass protected environments.
- SDK configuration reads use a repeatable-read transaction.
- API request bodies are limited to 1 MiB. Socket peers have a bounded per-process request quota. Configure trusted per-client rate limits at the reverse proxy; this process does not trust arbitrary forwarded IP headers.
- Tests use a fake email transport and committed database migrations.
- CI checks types, lint, tests, builds and high-severity production dependency advisories.

## Deployment

The baseline migration is for an empty database. Existing databases created with schema push require a reviewed baseline adoption procedure and a verified backup before running migrations. No production schema has been changed by this work.

The Node SDK has a standalone package build verified in an isolated Node and TypeScript consumer. Registry publication requires working registry credentials. Its setup snippet includes the configured API base URL, optional analytics and streaming. Other languages are not offered as released SDKs. Client keys use `POST /v1/sdk/evaluate` to receive evaluated values for explicitly browser-visible flags; full targeting snapshots remain server-only. Browser delivery rejects regex conditions to avoid evaluating backtracking expressions against public input.

## Larger features implemented

- New environment history entries capture configuration, rules and targets in the publish transaction. The dashboard compares snapshots and restores them, using approval requests for protected environments. Historic entries without complete snapshots cannot be restored. Variation values and segment definitions are not rolled back.
- Scheduled changes persist in PostgreSQL and are claimed with row locks. The server checks every 15 seconds. Execution rechecks membership, current permissions, environment protection and the expected version. Conflicts fail safely instead of overwriting a later publish. Scheduling currently supports unprotected environments; protected changes use immediate approval requests.
- Evaluation events use bounded batches, per-environment event-ID deduplication and HMAC subject identifiers. The analytics page reads real aggregates. Node reporting is opt-in and requires `events:write`; reporting failures never interrupt flag evaluation. The queue is bounded and may drop events, so figures describe received events rather than all application activity.
- Background cleanup enforces 90-day retention for evaluation events and audit records. Other retention durations remain unavailable.
- Segment conditions can be edited with the existing condition builder. Protected-reference checks still apply.
- Project archive/restore, duplication, and transfer are implemented. Archiving revokes keys and cancels pending schedules, approvals and rollback policies. Copies have new identities and start disabled/private; transfer requires workspace ownership in both destinations and preserves the source as an archive. Workspace switching validates current membership.
- Server-key SSE sends version notifications, revalidates keys, bounds connections and closes idle streams. Node SDK streaming reconnects and retains polling fallback. Credential rejection clears cached snapshots.
- The notification inbox exposes approval decisions, failed schedules, project lifecycle actions and automatic rollback, filtered by current project access. Read state is private to each user.
- Opt-in rollback policies count explicitly reported application outcomes for the armed release version. Minimum samples, error threshold, expiry, permission checks, protection checks and a version fence apply. Rollbacks and policy completion commit together. Protected environments do not support automatic rollback.

## Remaining core product work

- Implement domain/IP policy enforcement before enabling those settings.
- Publish a versioned Node SDK package and implement other language SDKs against the conformance suite.
- Add approved scheduled changes and multi-stage rollout plans.
- Test upgrades from a realistic existing production schema, restore from backup and multi-instance throttling.

Billing and paid integrations remain unavailable by user preference. No payment fixtures are presented as an actual subscription.
