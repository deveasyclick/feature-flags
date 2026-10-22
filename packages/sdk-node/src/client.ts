import {
  sdkConfigSchema,
  sdkStreamVersionSchema,
  type SdkConfig,
  type EvaluationEvent,
} from "@iwifunni/contracts";
import {
  evaluateSnapshot,
  notFoundOutcome,
  servedValue,
  toSubject,
  type EvaluationOutcome,
} from "@iwifunni/engine";

import { FeatureFlagsError, toError } from "#errors";
import { setTimeout as wait } from "node:timers/promises";

const DEFAULT_BASE_URL = "http://localhost:4000";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_REFRESH_INTERVAL_MS = 30_000;

/** The subject a flag is evaluated for. */
export interface FlagContext {
  userId: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface FlagDecision {
  flag: string;
  version: number | null;
  enabled: boolean;
  variation: string;
  value: unknown;
  reason: EvaluationOutcome["reason"];
}

export interface FeatureFlagsOptions {
  /** A runtime key, issued for one environment. Never a management key. */
  sdkKey: string;
  /** Optional. When given, it must match the environment the key was issued for. */
  environment?: string;
  /** Defaults to `http://localhost:4000`. */
  baseUrl?: string;
  timeoutMs?: number;
  /** `0` disables background refresh. Defaults to 30 seconds. */
  refreshIntervalMs?: number;
  telemetry?: boolean;
  streaming?: boolean;
  /** Transport failures preserve cached data; rejected credentials clear it. */
  onError?: (error: FeatureFlagsError) => void;
  /** Injected in tests. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/**
 * The Iwifunni Node.js SDK.
 *
 * `initialize()` downloads one environment's configuration and every read after
 * that is decided locally, so `isOn` is synchronous and no flag read costs a
 * round trip. Until the first snapshot lands — and if the API never answers —
 * every getter returns its caller's default, because a feature flag lookup that
 * throws would take the calling application down with it.
 */
export class FeatureFlags {
  private readonly sdkKey: string;
  private readonly environment?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly refreshIntervalMs: number;
  private readonly onError?: (error: FeatureFlagsError) => void;
  private readonly fetchImpl: typeof globalThis.fetch;

  private snapshot: SdkConfig | null = null;
  private etag: string | null = null;
  private identified: FlagContext | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly telemetry: boolean;
  private events: EvaluationEvent[] = [];
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;
  private readonly streaming: boolean;
  private streamController: AbortController | null = null;
  private streamTask: Promise<void> | null = null;
  private refreshTask: Promise<void> | null = null;

  constructor(options: FeatureFlagsOptions) {
    if (!options.sdkKey) {
      throw new FeatureFlagsError("unauthorized", "An SDK key is required.");
    }

    this.sdkKey = options.sdkKey;
    this.environment = options.environment;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.refreshIntervalMs =
      options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.onError = options.onError;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.telemetry = options.telemetry ?? false;
    this.streaming = options.streaming ?? false;
  }

  /**
   * Fetch the configuration and start refreshing it.
   *
   * Rejects when the first fetch fails, so a misconfigured key is a startup
   * error rather than a deployment that silently serves defaults; a failure
   * after that only reaches `onError`.
   */
  async initialize(): Promise<void> {
    this.closed = false;
    await this.refresh(true);
    this.schedule();
    if (this.streaming && !this.streamTask) {
      const controller = new AbortController();
      this.streamController = controller;
      this.streamTask = this.watch(controller.signal).finally(() => {
        if (this.streamController === controller) this.streamTask = null;
      });
    }
    if (this.telemetry && !this.telemetryTimer) {
      this.telemetryTimer = setInterval(() => {
        void this.flush();
      }, 10_000);
      this.telemetryTimer.unref?.();
    }
  }

  /** The subject used when a read does not carry one. */
  identify(context: FlagContext): void {
    this.identified = context;
  }

  isOn(flagKey: string, context?: FlagContext): boolean {
    return this.decide(flagKey, context).enabled;
  }

  isOff(flagKey: string, context?: FlagContext): boolean {
    return !this.isOn(flagKey, context);
  }

  getBoolean(
    flagKey: string,
    defaultValue: boolean,
    context?: FlagContext,
  ): boolean {
    const value = this.value(flagKey, context);

    return typeof value === "boolean" ? value : defaultValue;
  }

  getString(
    flagKey: string,
    defaultValue: string,
    context?: FlagContext,
  ): string {
    const value = this.value(flagKey, context);

    return typeof value === "string" ? value : defaultValue;
  }

  getNumber(
    flagKey: string,
    defaultValue: number,
    context?: FlagContext,
  ): number {
    const value = this.value(flagKey, context);

    return typeof value === "number" ? value : defaultValue;
  }

  getJson<T>(flagKey: string, defaultValue: T, context?: FlagContext): T {
    const value = this.value(flagKey, context);

    return value === undefined ? defaultValue : (value as T);
  }

  /** Stops the refresh timer. Idempotent. */
  close(): void {
    this.streamController?.abort();
    this.streamController = null;
    this.streamTask = null;
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    this.telemetryTimer = null;
    this.events = [];
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.closed = true;
  }

  /** The snapshot in force, for callers that want to inspect it. */
  get config(): SdkConfig | null {
    return this.snapshot;
  }

  private decide(flagKey: string, context?: FlagContext): EvaluationOutcome {
    if (!this.snapshot) return notFoundOutcome(flagKey);

    const subject = toSubject(context ?? this.identified ?? { userId: "" });

    const started = performance.now();
    const outcome = evaluateSnapshot(this.snapshot, flagKey, subject);
    if (
      this.telemetry &&
      !this.closed &&
      flagKey.length <= 128 &&
      this.events.length < 1000
    ) {
      this.events.push({
        kind: "evaluation",
        flagVersion: this.snapshot.flags.find((flag) => flag.key === flagKey)
          ?.version,
        id: crypto.randomUUID(),
        flagKey,
        variation: outcome.variation,
        reason: outcome.reason,
        userId: subject.id ? String(subject.id).slice(0, 256) : undefined,
        latencyMs: performance.now() - started,
      });
    }
    return outcome;
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.events.length || this.closed) return;
    const batch = this.events.splice(0, 100);
    this.flushing = (async () => {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/v1/sdk/events`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.sdkKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ events: batch }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500)
            throw new Error("Evaluation reporting is temporarily unavailable.");
          this.report(
            new FeatureFlagsError(
              "network",
              "Evaluation reporting was refused. Check the key's events:write scope.",
            ),
          );
        }
      } catch (error) {
        if (!this.closed)
          this.events = [...batch, ...this.events].slice(0, 1000);
        this.report(toError(error));
      }
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  evaluate(flagKey: string, context?: FlagContext): FlagDecision {
    const snapshot = this.snapshot;
    const decision = this.decide(flagKey, context);
    return {
      flag: flagKey,
      version:
        snapshot?.flags.find((flag) => flag.key === flagKey)?.version ?? null,
      enabled: decision.enabled,
      variation: decision.variation,
      reason: decision.reason,
      value: snapshot
        ? servedValue(snapshot, flagKey, decision.variation)
        : undefined,
    };
  }

  trackOutcome(
    decision: FlagDecision,
    success: boolean,
    context?: FlagContext,
  ): void {
    if (
      !this.telemetry ||
      this.closed ||
      !decision.version ||
      this.events.length >= 1000
    )
      return;
    const subject = toSubject(context ?? this.identified ?? { userId: "" });
    this.events.push({
      id: crypto.randomUUID(),
      kind: "outcome",
      outcome: success ? "success" : "error",
      flagVersion: decision.version,
      flagKey: decision.flag,
      variation: decision.variation,
      reason: decision.reason,
      userId: subject.id ? String(subject.id).slice(0, 256) : undefined,
      latencyMs: 0,
    });
  }

  private report(error: FeatureFlagsError): void {
    try {
      this.onError?.(error);
    } catch {
      /* Reporting must never interrupt flag evaluation. */
    }
  }

  private async watch(signal: AbortSignal): Promise<void> {
    while (!this.closed && !signal.aborted) {
      try {
        if (!(await this.readStream(signal))) return;
      } catch (error) {
        if (!signal.aborted) this.report(toError(error));
      }
      await wait(1000, undefined, { signal }).catch(() => undefined);
    }
  }

  private async readStream(lifecycle: AbortSignal): Promise<boolean> {
    const connection = new AbortController();
    const signal = AbortSignal.any([lifecycle, connection.signal]);
    let timeout = setTimeout(() => connection.abort(), this.timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => {
      void reader?.cancel().catch(() => undefined);
    };
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/sdk/stream`, {
        headers: {
          authorization: `Bearer ${this.sdkKey}`,
          accept: "text/event-stream",
        },
        signal,
      });
      if (response.status === 401 || response.status === 403) {
        this.snapshot = null;
        this.etag = null;
        this.events = [];
        this.report(
          new FeatureFlagsError(
            "unauthorized",
            "The streaming key was rejected.",
          ),
        );
        return false;
      }
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("text/event-stream") ||
        !response.body
      )
        throw new FeatureFlagsError(
          "invalid_response",
          "The streaming response was not an event stream.",
        );
      clearTimeout(timeout);
      reader = response.body.getReader();
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) return false;
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        timeout = setTimeout(() => connection.abort(), 45_000);
        const chunk = await reader.read();
        clearTimeout(timeout);
        if (chunk.done) return true;
        buffer = (
          buffer + decoder.decode(chunk.value, { stream: true })
        ).replace(/\r\n/g, "\n");
        if (buffer.length > 16_384)
          throw new FeatureFlagsError(
            "invalid_response",
            "Streaming message exceeds the size limit.",
          );
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const lines = buffer.slice(0, boundary).split("\n");
          buffer = buffer.slice(boundary + 2);
          const event = lines
            .find((line) => line.startsWith("event:"))
            ?.slice(6)
            .trim();
          if (event === "revoked") {
            this.snapshot = null;
            this.etag = null;
            this.events = [];
            return false;
          }
          if (event === "configuration") {
            const data: unknown = JSON.parse(
              lines
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart())
                .join("\n"),
            );
            const parsed = sdkStreamVersionSchema.safeParse(data);
            if (!parsed.success)
              throw new FeatureFlagsError(
                "invalid_response",
                "Invalid configuration notification.",
              );
            if (parsed.data.version !== this.snapshot?.version)
              await this.refresh(false);
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
      return !lifecycle.aborted;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
      await reader?.cancel().catch(() => undefined);
    }
  }

  private value(flagKey: string, context?: FlagContext): unknown {
    if (!this.snapshot) return undefined;

    const outcome = this.decide(flagKey, context);

    return servedValue(this.snapshot, flagKey, outcome.variation);
  }

  private schedule(): void {
    if (this.closed || this.refreshIntervalMs <= 0) return;

    // Jittered so a fleet of servers restarted together does not poll in step.
    const delay = this.refreshIntervalMs * (0.9 + Math.random() * 0.2);

    this.timer = setTimeout(() => {
      void this.refresh(false).finally(() => {
        this.schedule();
      });
    }, delay);

    this.timer.unref?.();
  }

  private async refresh(required: boolean): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = this.fetchSnapshot(required).finally(() => {
      this.refreshTask = null;
    });
    return this.refreshTask;
  }

  private async fetchSnapshot(required: boolean): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/sdk/config`, {
        headers: {
          authorization: `Bearer ${this.sdkKey}`,
          ...(this.etag ? { "if-none-match": this.etag } : {}),
        },
        signal: controller.signal,
      });

      if (response.status === 304) return;

      if (response.status === 401) {
        throw new FeatureFlagsError(
          "unauthorized",
          "The SDK key was rejected. It may be unknown, revoked or expired.",
        );
      }

      if (response.status === 403) {
        throw new FeatureFlagsError(
          "forbidden",
          "This key is not an SDK key for one environment.",
        );
      }

      if (!response.ok) {
        throw new FeatureFlagsError(
          "invalid_response",
          `The Iwifunni API answered ${response.status}.`,
        );
      }

      let body: unknown;

      try {
        body = await response.json();
      } catch (cause) {
        throw new FeatureFlagsError(
          "invalid_response",
          "The configuration was not JSON.",
          { cause },
        );
      }

      const parsed = sdkConfigSchema.safeParse(body);

      if (!parsed.success) {
        throw new FeatureFlagsError(
          "invalid_response",
          "The configuration did not match the SDK contract.",
          { cause: parsed.error },
        );
      }

      if (
        this.environment !== undefined &&
        parsed.data.environment.key !== this.environment
      ) {
        throw new FeatureFlagsError(
          "environment_mismatch",
          `This key is issued for "${parsed.data.environment.key}", not "${this.environment}".`,
        );
      }

      this.snapshot = parsed.data;
      this.etag = response.headers.get("etag") ?? `"${parsed.data.version}"`;
    } catch (cause) {
      const error = toError(cause);
      if (error.code === "unauthorized" || error.code === "forbidden") {
        this.snapshot = null;
        this.etag = null;
        this.events = [];
      }

      if (required) throw error;

      this.report(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
