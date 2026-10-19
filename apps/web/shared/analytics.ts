/**
 * The browser analytics facade.
 *
 * Every PostHog call in the dashboard goes through here, so "is analytics
 * configured?" is answered once — from `shared/env`, the only module in this app
 * that reads `process.env` — instead of being re-derived from a copy of the two
 * public variables at every call site.
 *
 * The client itself is initialised in `instrumentation-client.ts`, the browser
 * entry point Next runs before hydration. This module only captures through it.
 */

import posthog from "posthog-js";

import env from "./env";

/**
 * Whether both public variables are configured.
 *
 * The initialisation hook and every wrapper below read this same constant, so
 * the two cannot disagree: either analytics is on and the client is initialised,
 * or every call here is a no-op. Capturing before `init` is a silent no-op in the
 * SDK, which is the failure mode this removes.
 */
export const analyticsEnabled =
  env.analyticsKey !== undefined && env.analyticsHost !== undefined;

/** Person properties attached to an identified user. */
export interface AnalyticsPersonProperties {
  readonly email: string;
  readonly name: string;
  /** Workspace-level role, e.g. `owner`; only the dashboard chrome knows it. */
  readonly role?: string;
}

type AnalyticsEventProperties = Readonly<
  Record<string, string | number | boolean>
>;

export function identify(
  distinctId: string,
  properties: AnalyticsPersonProperties,
): void {
  if (!analyticsEnabled) return;

  posthog.identify(distinctId, {
    email: properties.email,
    name: properties.name,
    ...(properties.role === undefined ? {} : { role: properties.role }),
  });
}

export function capture(
  event: string,
  properties?: AnalyticsEventProperties,
): void {
  if (!analyticsEnabled) return;

  posthog.capture(event, properties);
}

export function captureException(error: unknown): void {
  if (!analyticsEnabled) return;

  posthog.captureException(error);
}

export function reset(): void {
  if (!analyticsEnabled) return;

  // Clears the persisted distinct ID as well as the in-memory identity. Without
  // the argument a sign-out leaves the previous person's ID in the browser, so
  // the next account to use it would inherit that person's history.
  posthog.reset(true);
}
