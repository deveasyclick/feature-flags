/**
 * Server-side session access.
 *
 * Server Components and route handlers resolve the session by asking the API,
 * forwarding the incoming cookies. They do not verify the cookie locally: the
 * API is the only place that knows whether a session is still valid, and
 * duplicating that check would let the two disagree.
 *
 * This is why `AppLayout` calls it on every request. If it becomes hot, the
 * answer is a short-lived cache — not trusting the client.
 */

import { cache } from "react";

import type { MeResponse } from "@iwifunni/contracts";

import env from "shared/env";

/**
 * Fetch the signed-in user, their workspace and the available sign-in methods.
 *
 * Returns `null` when there is no valid session. A non-401 failure is thrown
 * rather than swallowed, so an unreachable API surfaces as an error instead of
 * looking like a signed-out user — those two must not be confused, because one
 * is recoverable by signing in and the other is not.
 */
export const getSession = cache(async (): Promise<MeResponse | null> => {
  const { cookies } = await import("next/headers");
  const cookieHeader = (await cookies()).toString();

  if (!cookieHeader) return null;

  let response: Response;

  try {
    response = await fetch(`${env.apiInternalUrl}/v1/me`, {
      headers: { cookie: cookieHeader, accept: "application/json" },
      cache: "no-store",
    });
  } catch (cause) {
    throw new Error(
      `Could not reach the Iwifunni API at ${env.apiInternalUrl}. Is apps/api running?`,
      { cause },
    );
  }

  if (response.status === 401) return null;

  if (!response.ok) {
    throw new Error(
      `Iwifunni API returned ${response.status} for /v1/me.`,
    );
  }

  return (await response.json()) as MeResponse;
});
