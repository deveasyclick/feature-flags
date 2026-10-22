import { env } from "../config/index.js";

export const ERROR_CODE = {
  invalidRequest: "invalid_request",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  mfaRequired: "mfa_required",
  mfaEnrollmentRequired: "mfa_enrollment_required",
  notFound: "not_found",
  conflict: "conflict",
  approvalRequired: "approval_required",
  internalError: "internal_error",
  rateLimited: "rate_limited",
  payloadTooLarge: "payload_too_large",
} as const;

export const enabledProviders = {
  github:
    env.githubClientId !== undefined && env.githubClientSecret !== undefined,
  google:
    env.googleClientId !== undefined && env.googleClientSecret !== undefined,
} as const;

export type OAuthProviderName = keyof typeof enabledProviders;

/**
 * The browser origins allowed to call this API with credentials.
 *
 * One list, because the CORS allow-list and Better Auth's `trustedOrigins` have
 * to agree: the middleware answers the preflight and Better Auth decides whether
 * to trust the origin, so an origin in one and not the other is a dashboard that
 * signs in and then reads nothing. Kept without a trailing slash, which would
 * never match the `Origin` header a browser sends.
 */
export const dashboardOrigins = [
  "http://localhost:3000",
  "https://flags.iwifunni.cc",
];
