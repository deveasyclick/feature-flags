import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { ERROR_CODE } from "../constants.js";

type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(
    status: ContentfulStatusCode,
    code: ErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, ERROR_CODE.invalidRequest, message, details);
  }

  static rateLimited(): ApiError {
    return new ApiError(
      429,
      ERROR_CODE.rateLimited,
      "Too many requests. Try again shortly.",
    );
  }

  static payloadTooLarge(): ApiError {
    return new ApiError(
      413,
      ERROR_CODE.payloadTooLarge,
      "Request body exceeds the 1 MiB limit.",
    );
  }

  static unauthorized(message = "Sign in to continue."): ApiError {
    return new ApiError(401, ERROR_CODE.unauthorized, message);
  }

  static forbidden(message: string): ApiError {
    return new ApiError(403, ERROR_CODE.forbidden, message);
  }

  static mfaRequired(): ApiError {
    return new ApiError(
      403,
      ERROR_CODE.mfaRequired,
      "Verify your two-factor code to continue.",
    );
  }

  static mfaEnrollmentRequired(): ApiError {
    return new ApiError(
      403,
      ERROR_CODE.mfaEnrollmentRequired,
      "Your workspace requires two-factor authentication. Enroll to continue.",
    );
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, ERROR_CODE.notFound, message);
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, ERROR_CODE.conflict, message, details);
  }

  /**
   * A protected environment refused a direct publish. Carries its own code so
   * the dashboard can offer the change-request flow instead of showing a
   * conflict the user cannot act on.
   */
  static approvalRequired(environmentKey: string): ApiError {
    return new ApiError(
      409,
      ERROR_CODE.approvalRequired,
      `"${environmentKey}" is a protected environment. Propose the change for approval instead of publishing it directly.`,
      { environmentKey },
    );
  }
}

export function errorResponse(c: Context, error: unknown) {
  if (error instanceof ApiError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
      error.status,
    );
  }

  console.error("[api] unhandled error", error);

  return c.json(
    {
      error: {
        code: ERROR_CODE.internalError,
        message: "Something went wrong. Please try again.",
      },
    },
    500,
  );
}
