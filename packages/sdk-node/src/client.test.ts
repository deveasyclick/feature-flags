import { readFileSync } from "node:fs";

import type { SdkConfig } from "@iwifunni/contracts";
import { describe, expect, it, vi } from "vitest";

import { FeatureFlags, FeatureFlagsError, type FlagContext } from "./index.js";

interface CorpusCase {
  name: string;
  config: SdkConfig;
  context: FlagContext;
  expect: { flag: string; enabled: boolean; variation: string; reason: string };
  value?: unknown;
}

const CORPUS = JSON.parse(
  readFileSync(
    new URL("../../../sdks/fixtures/conformance.json", import.meta.url),
    "utf8",
  ),
) as { snapshot: CorpusCase[] };

/** One corpus case, by the label it carries in the fixture. */
function corpusCase(name: string): CorpusCase {
  const found = CORPUS.snapshot.find((entry) => entry.name === name);

  if (!found) throw new Error(`The corpus lost the case ${name}.`);

  return found;
}

/** A `fetch` that answers with one configuration, and records what it was sent. */
function stubFetch(
  config: SdkConfig,
  options: { status?: number; etag?: string } = {},
) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];

  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });

    const status = options.status ?? 200;

    if (status !== 200) return new Response("", { status });

    return new Response(JSON.stringify(config), {
      status: 200,
      headers: {
        "content-type": "application/json",
        etag: options.etag ?? `"${config.version}"`,
      },
    });
  }) as unknown as typeof globalThis.fetch;

  return { fetchImpl, calls };
}

function clientFor(
  config: SdkConfig,
  fetchImpl: typeof globalThis.fetch,
): FeatureFlags {
  return new FeatureFlags({
    sdkKey: "ff_test.abc",
    environment: config.environment.key,
    refreshIntervalMs: 0,
    fetch: fetchImpl,
  });
}

describe("conformance", () => {
  it("reports application outcomes separately and includes the evaluated release version", async () => {
    const entry = CORPUS.snapshot[0];
    if (!entry) throw new Error("The conformance corpus is empty.");
    const batches: Array<{
      events: Array<{ kind: string; outcome: string; flagVersion: number }>;
    }> = [];
    let version = 2;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith("/events")) {
        batches.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 202 });
      }
      return new Response(
        JSON.stringify({
          ...entry.config,
          flags: entry.config.flags.map((flag) => ({ ...flag, version })),
        }),
      );
    }) as typeof globalThis.fetch;
    const client = new FeatureFlags({
      sdkKey: "ff_test.abc",
      telemetry: true,
      refreshIntervalMs: 0,
      fetch: fetchImpl,
    });
    try {
      await client.initialize();
      const decision = client.evaluate(entry.expect.flag);
      await client.flush();
      batches.length = 0;
      version = 3;
      await client.initialize();
      expect(client.config?.flags[0]?.version).toBe(3);
      client.trackOutcome(decision, false);
      client.trackOutcome(decision, true);
      await client.flush();
      expect(batches[0]?.events).toMatchObject([
        { kind: "outcome", outcome: "error", flagVersion: 2 },
        { kind: "outcome", outcome: "success", flagVersion: 2 },
      ]);
    } finally {
      client.close();
    }
  });

  it("refreshes on a streamed version notification and cancels the stream on close", async () => {
    const entry = CORPUS.snapshot[0];
    if (!entry) throw new Error("The conformance corpus is empty.");
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let cancelled = false;
    let configCalls = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = (async (url: unknown) => {
      if (String(url).endsWith("/stream"))
        return new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      configCalls++;
      return new Response(
        JSON.stringify({
          ...entry.config,
          version: configCalls === 1 ? "one" : "two",
        }),
        { status: 200 },
      );
    }) as typeof globalThis.fetch;
    const client = new FeatureFlags({
      sdkKey: "ff_test.abc",
      streaming: true,
      refreshIntervalMs: 0,
      fetch: fetchImpl,
    });
    try {
      await client.initialize();
      controller?.enqueue(
        new TextEncoder().encode(
          'event: configuration\ndata: {"version":"two"}\n\n',
        ),
      );
      await vi.waitFor(() => expect(client.config?.version).toBe("two"));
      expect(configCalls).toBe(2);
      controller?.enqueue(
        new TextEncoder().encode("event: revoked\ndata: {}\n\n"),
      );
      await vi.waitFor(() => expect(client.config).toBeNull());
    } finally {
      client.close();
    }
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });

  it("buffers opt-in telemetry and retries with the same event identifiers", async () => {
    const entry = CORPUS.snapshot[0];
    if (!entry) throw new Error("The conformance corpus is empty.");
    const batches: Array<{
      events: Array<{ id: string; flagKey: string; userId: string }>;
    }> = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith("/events")) {
        batches.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: batches.length === 1 ? 503 : 202 });
      }
      return new Response(JSON.stringify(entry.config), { status: 200 });
    }) as typeof globalThis.fetch;
    const errors = vi.fn(() => {
      throw new Error("The consumer's error handler failed.");
    });
    const client = new FeatureFlags({
      sdkKey: "ff_test.abc",
      fetch: fetchImpl,
      telemetry: true,
      refreshIntervalMs: 0,
      onError: errors,
    });
    try {
      await client.initialize();
      client.isOn(entry.expect.flag, { userId: "subject-1" });
      expect(batches).toHaveLength(0);
      await client.flush();
      await client.flush();
      expect(batches).toHaveLength(2);
      expect(batches[1]).toEqual(batches[0]);
      expect(batches[0]?.events[0]).toMatchObject({
        flagKey: entry.expect.flag,
        userId: "subject-1",
      });
      expect(errors).toHaveBeenCalledOnce();
      await client.flush();
      expect(batches).toHaveLength(2);
    } finally {
      client.close();
    }
  });

  it.each(CORPUS.snapshot.map((entry) => [entry.name, entry] as const))(
    "%s",
    async (_name, entry) => {
      const { fetchImpl } = stubFetch(entry.config);
      const client = clientFor(entry.config, fetchImpl);

      await client.initialize();

      expect(client.isOn(entry.expect.flag, entry.context)).toBe(
        entry.expect.enabled,
      );
      expect(client.isOff(entry.expect.flag, entry.context)).toBe(
        !entry.expect.enabled,
      );

      const value = entry.value;

      if (typeof value === "boolean") {
        expect(
          client.getBoolean(entry.expect.flag, !value, entry.context),
        ).toBe(value);
      } else if (typeof value === "string") {
        expect(
          client.getString(entry.expect.flag, "fallback", entry.context),
        ).toBe(value);
      } else if (typeof value === "number") {
        expect(client.getNumber(entry.expect.flag, -1, entry.context)).toBe(
          value,
        );
      } else if (value === undefined) {
        // Nothing was served, so every getter keeps its caller's default.
        expect(client.getBoolean(entry.expect.flag, true, entry.context)).toBe(
          true,
        );
      }

      client.close();
    },
  );
});

describe("FeatureFlags", () => {
  const config = corpusCase(
    "an active flag with no targeting serves its default variation",
  ).config;

  it("returns defaults before initialize and after close", () => {
    const { fetchImpl } = stubFetch(config);
    const client = clientFor(config, fetchImpl);

    expect(client.isOn("checkout-v2")).toBe(false);
    expect(client.getBoolean("checkout-v2", true)).toBe(true);
    expect(client.getString("checkout-v2", "fallback")).toBe("fallback");
    expect(client.getNumber("checkout-v2", 7)).toBe(7);
    expect(client.getJson("checkout-v2", { fallback: true })).toEqual({
      fallback: true,
    });
  });

  it("sends the key and the stored ETag on a second fetch", async () => {
    const { fetchImpl, calls } = stubFetch(config);
    const client = clientFor(config, fetchImpl);

    await client.initialize();
    await client.initialize();
    client.close();

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain("/v1/sdk/config");
    expect(calls[0]?.headers.authorization).toBe("Bearer ff_test.abc");
    expect(calls[0]?.headers["if-none-match"]).toBeUndefined();
    expect(calls[1]?.headers["if-none-match"]).toBe(`"${config.version}"`);
  });

  it("rejects an unknown key", async () => {
    const { fetchImpl } = stubFetch(config, { status: 401 });
    const client = clientFor(config, fetchImpl);

    await expect(client.initialize()).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("rejects a management key", async () => {
    const { fetchImpl } = stubFetch(config, { status: 403 });
    const client = clientFor(config, fetchImpl);
    const caught = await client.initialize().catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(FeatureFlagsError);
    expect(caught).toMatchObject({ code: "forbidden" });
  });

  it("rejects a body that is not JSON", async () => {
    const fetchImpl = (async () =>
      new Response("<html>bad gateway</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof globalThis.fetch;
    const client = clientFor(config, fetchImpl);
    const caught = await client.initialize().catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(FeatureFlagsError);
    expect(caught).toMatchObject({ code: "invalid_response" });
  });

  it("rejects a key issued for another environment", async () => {
    const { fetchImpl } = stubFetch(config);
    const client = new FeatureFlags({
      sdkKey: "ff_test.abc",
      environment: "development",
      refreshIntervalMs: 0,
      fetch: fetchImpl,
    });

    await expect(client.initialize()).rejects.toMatchObject({
      code: "environment_mismatch",
    });
  });

  it("prefers a per-call context over the identified one", async () => {
    const targeted = corpusCase("an individual target wins over a rule");
    const { fetchImpl } = stubFetch(targeted.config);
    const client = clientFor(targeted.config, fetchImpl);
    await client.initialize();

    // The identified subject does not match the override, so the rule serves.
    client.identify({ userId: "someone-else" });
    expect(client.isOn("checkout-v2")).toBe(true);

    // The per-call subject does match it.
    expect(client.isOn("checkout-v2", { userId: "user-1" })).toBe(false);

    client.close();
  });

  it("keeps serving the last snapshot when a refresh fails", async () => {
    vi.useFakeTimers();

    try {
      const onError = vi.fn();
      let calls = 0;
      const fetchImpl = (async () => {
        calls += 1;

        if (calls > 1) throw new Error("offline");

        return new Response(JSON.stringify(config), {
          status: 200,
          headers: { "content-type": "application/json", etag: '"v1"' },
        });
      }) as unknown as typeof globalThis.fetch;

      const client = new FeatureFlags({
        sdkKey: "ff_test.abc",
        environment: config.environment.key,
        refreshIntervalMs: 1_000,
        onError,
        fetch: fetchImpl,
      });

      await client.initialize();
      await vi.advanceTimersByTimeAsync(1_500);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(client.config?.version).toBe(config.version);

      client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([401, 403])(
    "discards a cached configuration after key rejection (%s)",
    async (status) => {
      vi.useFakeTimers();
      let client: FeatureFlags | undefined;
      try {
        let calls = 0;
        const fetchImpl = (async () => {
          calls++;
          return calls === 1
            ? new Response(JSON.stringify(config), { status: 200 })
            : new Response(null, { status });
        }) as typeof globalThis.fetch;
        client = new FeatureFlags({
          sdkKey: "ff_test.abc",
          fetch: fetchImpl,
          refreshIntervalMs: 1000,
        });
        await client.initialize();
        expect(client.config).not.toBeNull();
        await vi.advanceTimersByTimeAsync(1500);
        expect(client.config).toBeNull();
        expect(client.getBoolean("checkout-v2", false)).toBe(false);
      } finally {
        client?.close();
        vi.useRealTimers();
      }
    },
  );

  it("stops refreshing after close", async () => {
    vi.useFakeTimers();

    try {
      const { fetchImpl, calls } = stubFetch(config);
      const client = new FeatureFlags({
        sdkKey: "ff_test.abc",
        environment: config.environment.key,
        refreshIntervalMs: 1_000,
        fetch: fetchImpl,
      });

      await client.initialize();
      expect(calls).toHaveLength(1);

      client.close();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(calls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
