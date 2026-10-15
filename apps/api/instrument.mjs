import * as Sentry from "@sentry/hono/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  dsn: "https://438ca5c7cf4d6053d6edcbe1336c0a14@o4512258656829440.ingest.de.sentry.io/4512259422093392",
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: 1.0,
  profileSessionSampleRate: 1.0,
  profileLifecycle: "trace",
});
