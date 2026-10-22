"use client";

import { emailOTPClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import env from "shared/env";

export const authClient = createAuthClient({
  baseURL: env.apiUrl,
  /** The session cookie lives on the API origin, so it is sent cross-origin. */
  fetchOptions: {
    credentials: "include",
  },
  /**
   * The workspace **is** the Better Auth organization, so the client
   * needs the matching plugin to reach `organization.create`. Without it the
   * method does not exist and TypeScript says so, which is how this was caught.
   *
   * `emailOTPClient` is the other half of the confirmation flow: it adds
   * `emailOtp.sendVerificationOtp` and `emailOtp.verifyEmail`, which replace the
   * emailed link with a code the user types on this site.
   */
  plugins: [organizationClient(), emailOTPClient(), twoFactorClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;

/**
 * Translate a Better Auth failure into the single line each form renders above
 * its submit button.
 *
 * Better Auth returns a machine-readable `code` plus a human `message`. The
 * message is usually presentable, but the cases that matter most to a user —
 * wrong password, address already taken — are worth saying plainly rather than
 * passing through verbatim, and several raw codes are not user-facing English.
 */
export function authErrorMessage(error: {
  code?: string | undefined;
  message?: string | undefined;
}): string {
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password combination is not recognised.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with that email already exists. Try signing in instead.";
    case "PASSWORD_TOO_SHORT":
      return "Password must be at least 8 characters.";
    case "PASSWORD_TOO_LONG":
      return "Password must be at most 128 characters.";
    case "INVALID_EMAIL":
      return "Enter a valid email address.";
    case "EMAIL_NOT_VERIFIED":
      return "Confirm your email address before signing in — we'll send you a code.";
    case "INVALID_OTP":
      return "That code is not right. Check the email and try again.";
    case "OTP_EXPIRED":
      return "That code has expired. Ask for a new one.";
    case "TOO_MANY_ATTEMPTS":
      return "Too many attempts with that code. Ask for a new one.";
    case "MISSING_OR_NULL_ORIGIN":
    case "INVALID_ORIGIN":
      return "This request came from an origin the API does not trust.";
    case "SOCIAL_PROVIDER_NOT_CONFIGURED":
      return "That sign-in method is not configured on this deployment.";
    default:
      return error.message?.trim() || "Something went wrong. Please try again.";
  }
}
