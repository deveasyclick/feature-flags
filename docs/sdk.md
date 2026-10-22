# SDKs

How an application reads flags at runtime: the credential, the one endpoint an SDK
calls, the snapshot it evaluates from, and the surface every language exposes.

The decision algorithm is `docs/evaluation.md`; the key rows are `docs/domain-model.md`;
who may issue a key is `docs/authorization.md`; the wire shapes are
`docs/api-conventions.md`.

## The key is a runtime credential

A server SDK key is issued for **one environment** of one project and requires `flags:read`. It may additionally carry `events:write` for opt-in analytics. Only `server` keys can download a snapshot. Client keys receive evaluated values through `POST /v1/sdk/evaluate`. Full targeting data must never be shipped to a browser.

- Management routes (`/v1/projects/**`) mount the session middleware only, so an
  SDK key is not a credential they accept at all.
- `POST /v1/evaluate` still requires a session; it is the dashboard's debugger.
- The SDK surface (`/v1/sdk/config`) accepts only a key, and only of kind `server`
  with the read scope.

That is the whole enforcement: there is no management handler that has to
remember to check a scope for an SDK key to be harmless there.

| Kind | Issued for | Used by |
| --- | --- | --- |
| `management` | reserved | Not accepted by session-only management routes or the SDK endpoint |
| `server` | one environment | Node.js; additional language SDKs are not released |
| `client` | one environment | Evaluated values only; never configuration snapshots |

A server or client key requires an environment and the `flags:read` scope;
issuing one without either is a `400`. A management key presented to the SDK
surface is a `403`, not a `401`: it authenticated, and it is the wrong kind.

### How a key is transmitted

`Authorization: Bearer <secret>`. The secret is `<prefix>.<random>`: the prefix is
the non-secret identifier the dashboard lists and the API indexes on, and only a
SHA-256 digest of the whole secret is stored. The comparison is constant-time.
The separator is a dot because the random body is base64url, which may itself
contain `_`.

Unknown, malformed, revoked and expired keys are all `401 unauthorized` — telling
them apart would confirm a secret that is already dead.

## The one endpoint

`GET /v1/sdk/config`, mounted outside any project path because the key names its
own project and environment. Nothing in the request chooses what is read.

| Aspect | Contract |
| --- | --- |
| Request | `Authorization: Bearer <sdkKey>`, optional `If-None-Match` |
| `200` | the snapshot below |
| Headers | `ETag: "<version>"`, `Cache-Control: no-store` |
| `304` | the snapshot is unchanged; the body is empty |
| `401` | missing or malformed header, unknown, revoked or expired key |
| `403` | a management key, a key without `flags:read`, or a project-wide key |

`version` is a content digest of the payload, which is what the SDK compares to
decide whether a refresh changed anything. The arrays are ordered — flags and
segments by key, rules by priority and id, conditions by priority and id, targets by subject —
so the same database state always hashes to the same version.

## The snapshot

```jsonc
{
  "version": "9f2c…",
  "project": { "key": "checkout", "name": "Checkout" },
  "environment": { "key": "production", "name": "Production" },
  "flags": [
    {
      "key": "checkout-v2",
      "type": "boolean",
      "status": "active",
      "enabled": true,
      "offVariation": "off",
      "defaultVariation": "on",
      "rolloutPercentage": 0,
      "bucketBy": "userId",
      "variations": [{ "key": "on", "value": true }, { "key": "off", "value": false }],
      "rules": [
        {
          "id": "…",
          "priority": 0,
          "variation": "on",
          "segmentKeys": ["beta-users"],
          "rolloutPercentage": null,
          "bucketBy": null,
          "conditions": [{ "attribute": "plan", "operator": "equals", "values": ["beta"] }]
        }
      ],
      "targets": [{ "userId": "user-1", "variation": "off" }]
    }
  ],
  "segments": [
    { "key": "beta-users", "conditions": [{ "attribute": "plan", "operator": "equals", "values": ["beta"] }] }
  ]
}
```

It carries everything the engine reads, and the variation values the typed
getters return. Archived flags and archived segments are included: the engine
serves the off variation for an archived flag, and a flag that vanished from a
client's snapshot would change what that client serves without anybody editing it.

A client key is public by nature, so a browser SDK downloads the targeting rules
and segments of its environment. That is configuration, not secret material, and
it is what local evaluation requires.

## The surface

```
new FeatureFlags({ sdkKey, environment?, baseUrl?, timeoutMs?, refreshIntervalMs?, onError? })
initialize(): Promise<void>
identify({ userId, attributes? })
isOn(key, context?): boolean
isOff(key, context?): boolean
getBoolean(key, defaultValue, context?): boolean
getString(key, defaultValue, context?): string
getNumber(key, defaultValue, context?): number
getJson(key, defaultValue, context?): T
close(): void
```

- `initialize()` downloads the snapshot and starts a jittered refresh (30s by
  default, `0` disables). It rejects when the first fetch fails, so a
  misconfigured key is a startup error rather than a deployment that silently
  serves defaults; a later failure calls `onError` and keeps the last snapshot.
- Reads are synchronous and local. `identify` sets the default subject; a
  per-call `context` overrides it. With neither, the subject is `{ id: "" }`.
- The subject is flat: `attributes` are spread onto it as sent and `userId`
  becomes `id`. Attribute keys are matched literally, so a rule targeting `plan`
  reads the attribute an application sent as `plan`; a rule on `user.plan` would
  need a key of exactly that name. `docs/evaluation.md` has the naming rule.
- `isOn` is the engine's `enabled` — the served variation is not the off
  variation. A flag the snapshot does not carry, or any read before the first
  snapshot, is `false`.
- The typed getters are strict: `getString` returns only a string, `getNumber`
  only a number (no coercion of numeric strings), `getBoolean` only a boolean,
  `getJson` any JSON value. A type mismatch returns the caller's default.
- `close()` stops the refresh timer and is idempotent.

## Packages

| Language | Package | Status |
| --- | --- | --- |
| Node | `@iwifunni-flag/core` (`packages/sdk-node`) | built, not published |
| React | `@iwifunni/react` | planned |
| Python | `iwifunni` | planned |
| Go | `github.com/iwifunni/iwifunni-go` | planned |
| Java | `dev.iwifunni:iwifunni-java` | planned |
| Ruby | `iwifunni` | planned |
| PHP | `iwifunni/iwifunni` | planned |
| .NET | `Iwifunni` | planned |

The TypeScript engine in `packages/engine` is the reference implementation and
the Node SDK uses it directly. `@iwifunni-flag/core` is `private` and consumed from the
workspace: it is not on npm yet, so the install snippet is aspirational until it
is published. Every other language re-implements it and is held
to the same corpus.

## The conformance corpus

`sdks/fixtures/conformance.json` is generated from the reference engine
(`pnpm --filter @iwifunni/engine fixtures`) and committed. It pins bucketing
vectors, whole snapshot-to-decision cases and the values the getters should
return. The engine's own test fails while the file is out of date, so a change to
the algorithm cannot silently drift from the other implementations; each SDK's
test suite reads the same file.

`pnpm check` covers the TypeScript workspaces only (`@iwifunni/engine`,
`@iwifunni-flag/core`, `apps/api`, `apps/web`). The other languages run their own test
command, documented in their directory, and their conformance test is what keeps
them honest.

## Where it lives

- `apps/api/src/middleware/api-key.ts` — the key middleware and `requireApiKey`.
- `apps/api/src/modules/sdk/` — the config endpoint: repository, mapper, service
  (the snapshot and its version), controller and routes.
- `apps/api/src/modules/api-keys/api-keys.service.ts` — `resolveApiKey`, and the
  kind/scope rules an SDK key is issued under.
- `packages/contracts/src/sdk.ts` — the snapshot contract.
- `packages/engine/` — the pure engine, the SHA-256 it buckets with, and the
  snapshot adapter (`evaluateSnapshot`, `servedValue`, `toSubject`).
- `packages/sdk-node/` — the Node SDK.
- `sdks/fixtures/conformance.json` — the corpus every SDK is tested against.

Snapshots are assembled in a read-only repeatable-read transaction so one response cannot mix configuration from different commits.
