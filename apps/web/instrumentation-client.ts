// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";

import env from "shared/env";

// A missing variable turns every capture into a silent no-op, which is the
// failure that is hardest to notice, so development stops instead. Production
// stays a no-op: a deployment that has not configured analytics must still run.
const missingConfiguration = [
  ["NEXT_PUBLIC_POSTHOG_KEY", env.analyticsKey],
  ["NEXT_PUBLIC_POSTHOG_HOST", env.analyticsHost],
].find(([, value]) => value === undefined)?.[0];

if (missingConfiguration && env.environment === "development") {
  throw new Error(
    `${missingConfiguration} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingConfiguration} is configured`,
  );
}

if (env.analyticsKey && env.analyticsHost) {
  posthog.init(env.analyticsKey, {
    api_host: env.analyticsHost,
    defaults: "2026-01-30",
    capture_exceptions: true,
    debug: env.environment === "development",
  });
}

Sentry.init({
  dsn: "https://eb94aae893432ff135c186933faf1aba@o4512258656829440.ingest.de.sentry.io/4512258666463312",

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want to set it to 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
