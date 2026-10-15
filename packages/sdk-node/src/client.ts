import { sdkConfigSchema, type SdkConfig } from "@iwifunni/contracts";
import {
  evaluateSnapshot,
  notFoundOutcome,
  servedValue,
  toSubject,
  type EvaluationOutcome,
} from "@iwifunni/engine";

import { FeatureFlagsError, toError } from "#errors";

const DEFAULT_BASE_URL = "http://localhost:4000";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_REFRESH_INTERVAL_MS = 30_000;

/** The subject a flag is evaluated for. */
export interface FlagContext {
  userId: string;
  attributes?: Record<string, string | number | boolean>;
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
  /** Called when a background refresh fails; the last snapshot keeps serving. */
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

    return evaluateSnapshot(this.snapshot, flagKey, subject);
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

      if (required) throw error;

      this.onError?.(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
