# Iwifunni Node SDK

Evaluate feature flags locally using an environment-scoped server key. Requires Node.js 20.9 or later.

```ts
import { FeatureFlags } from "@iwifunni-flag/core";

const flags = new FeatureFlags({
  sdkKey: process.env.IWIFUNNI_SDK_KEY!,
  baseUrl: "http://localhost:4000",
  streaming: true,
  telemetry: true,
});
await flags.initialize();

const context = { userId: "user-123", attributes: { country: "NG" } };
const enabled = flags.isOn("new-checkout", context);
const message = flags.getString("welcome-message", "Welcome", context);
```

Use `getBoolean`, `getString`, `getNumber`, or `getJSON` to supply a fallback value.
Initialization rejects invalid credentials or an unavailable first snapshot. Later transport failures
preserve the last configuration. Rejected or revoked credentials clear cached data on the next refresh.

Streaming is optional and defaults off. It refreshes changed snapshots and reconnects after interruptions;
the usual background polling remains a fallback. `refreshIntervalMs: 0` disables polling.

Telemetry defaults off and requires an additional `events:write` scope. Evaluation reporting is bounded
and best effort. Reporting failures do not interrupt flag reads; errors reach the optional `onError` callback.

Report application outcomes explicitly when using automatic rollback:

```ts
const decision = flags.evaluate("new-checkout", context);
// Use decision.enabled or decision.value to choose the application behavior.
flags.trackOutcome(decision, requestSucceeded, context);
await flags.flush();
```

Outcomes carry the version actually evaluated by this SDK. Only outcomes for an armed policy's version
count toward rollback. Evaluate and report using the same initialized client and deployment context.
Do not use browser keys in this package or expose server keys to users.

`flush()` sends one batch of up to 100 buffered events. Call it before `close()`, which stops timers,
closes streaming, and discards pending reports. Flag values are configuration; application authorization
must still be enforced independently.
