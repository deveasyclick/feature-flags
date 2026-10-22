import { Hono } from "hono";

import type { ApiKeyEnv } from "../../middleware/api-key.js";
import type { SdkRoutesDeps } from "./sdk.types.js";

/** Mounted at `/`: the SDK surface sits outside any project path. */
export function createSdkRoutes({
  controller,
  apiKeyMiddleware,
}: SdkRoutesDeps): Hono<ApiKeyEnv> {
  const routes = new Hono<ApiKeyEnv>();

  // Scoped to the one path: a bare "*" on a router mounted at "/" would run
  // this on every route, not just this surface.
  routes.use("/v1/sdk/config", apiKeyMiddleware);
  routes.use("/v1/sdk/stream", apiKeyMiddleware);
  routes.use("/v1/sdk/evaluate", apiKeyMiddleware);

  routes.get("/v1/sdk/config", (c) => controller.config(c));
  routes.get("/v1/sdk/stream", (c) => controller.stream(c));
  routes.post("/v1/sdk/evaluate", (c) => controller.evaluateClient(c));

  return routes;
}
