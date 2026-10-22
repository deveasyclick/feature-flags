import { Hono, type MiddlewareHandler } from "hono";
import type { AnalyticsController } from "./analytics.controller.js";
import type { SessionEnv } from "../auth/index.js";
import type { ApiKeyEnv } from "../../middleware/api-key.js";

export function createAnalyticsRoutes(
  controller: AnalyticsController,
  sessionMiddleware: MiddlewareHandler,
  apiKeyMiddleware: MiddlewareHandler<ApiKeyEnv>,
): Hono {
  const routes = new Hono();
  const dashboard = new Hono<SessionEnv>();
  dashboard.use("*", sessionMiddleware);
  dashboard.get("/", (c) => controller.summary(c));
  const ingestion = new Hono<ApiKeyEnv>();
  ingestion.use("*", apiKeyMiddleware);
  ingestion.post("/", (c) => controller.ingest(c));
  routes.route("/v1/analytics", dashboard);
  routes.route("/v1/sdk/events", ingestion);
  return routes;
}
