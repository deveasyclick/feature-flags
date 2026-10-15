/**
 * Everything the SDK can fail at, as one type with a code to branch on.
 *
 * `unauthorized` means the key is unknown, revoked or expired; `forbidden` means
 * it is a management key or one without the read scope. They are kept apart
 * because the fix differs: issue a new key, or issue an SDK key at all.
 */
export type FeatureFlagsErrorCode =
  | "unauthorized"
  | "forbidden"
  | "network"
  | "timeout"
  | "invalid_response"
  | "environment_mismatch";

export class FeatureFlagsError extends Error {
  readonly code: FeatureFlagsErrorCode;

  constructor(
    code: FeatureFlagsErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "FeatureFlagsError";
    this.code = code;
  }
}

/** A thrown value, as the SDK's own error, so callers never see a bare string. */
export function toError(cause: unknown): FeatureFlagsError {
  if (cause instanceof FeatureFlagsError) return cause;

  if (cause instanceof Error && cause.name === "AbortError") {
    return new FeatureFlagsError(
      "timeout",
      "The Iwifunni API did not answer in time.",
      { cause },
    );
  }

  return new FeatureFlagsError(
    "network",
    "The Iwifunni API could not be reached.",
    { cause },
  );
}
