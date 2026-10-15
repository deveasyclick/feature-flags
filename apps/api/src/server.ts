import net from "node:net";

import { serve } from "@hono/node-server";

import { app } from "./app.js";
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

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    console.warn(`[api] ${signal} again — exiting immediately`);
    process.exit(1);
  }

  shuttingDown = true;
  console.info(`[api] ${signal} received, shutting down`);

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  await closeDatabase();
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
