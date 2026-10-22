import net from "node:net";

import { serve } from "@hono/node-server";

import {
  app,
  runDueFlagSchedules,
  retainEvaluationEvents,
  runFlagRollbackPolicies,
} from "./app.js";
import { env } from "./config/index.js";
import { closeDatabase } from "./db/client.js";

const HOST = "0.0.0.0";
const OUTBOUND_CONNECT_ATTEMPT_TIMEOUT_MS = 1500;

// Happy Eyeballs abandons an address after 250 ms, which is shorter than the TCP
// handshake to Google and Brevo here, so every outbound fetch died with ETIMEDOUT.
net.setDefaultAutoSelectFamilyAttemptTimeout(
  OUTBOUND_CONNECT_ATTEMPT_TIMEOUT_MS,
);

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.info(
    `[api] listening on http://${HOST}:${info.port} (${env.nodeEnv})`,
  );
});

// Close the listener before draining the pool, so in-flight requests finish. A
// second signal exits immediately rather than hanging on a stuck connection.
let shuttingDown = false;
let scheduling = false;
let schedulingRun: Promise<void> = Promise.resolve();
let nextRetentionAt = 0;
const scheduleTimer = setInterval(() => {
  if (scheduling || shuttingDown) return;
  scheduling = true;
  schedulingRun = runDueFlagSchedules()
    .then(async () => {
      await runFlagRollbackPolicies();
      if (Date.now() >= nextRetentionAt) {
        await retainEvaluationEvents();
        nextRetentionAt = Date.now() + 3_600_000;
      }
    })
    .catch((error: unknown) => {
      console.error("[scheduler] run failed", error);
    })
    .finally(() => {
      scheduling = false;
    });
}, 15_000);
scheduleTimer.unref();

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    console.warn(`[api] ${signal} again — exiting immediately`);
    process.exit(1);
  }

  shuttingDown = true;
  clearInterval(scheduleTimer);
  console.info(`[api] ${signal} received, shutting down`);

  const drainTimeout = setTimeout(() => {
    if (
      "closeAllConnections" in server &&
      typeof server.closeAllConnections === "function"
    )
      server.closeAllConnections();
  }, 10_000);
  drainTimeout.unref();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  clearTimeout(drainTimeout);

  await schedulingRun;
  await closeDatabase();
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
