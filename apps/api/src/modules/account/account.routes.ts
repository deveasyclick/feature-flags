import { Hono } from "hono";

import type { SessionEnv } from "../auth/auth.types.js";
import type { AccountRoutesDeps } from "./account.types.js";
export type { AccountRoutesDeps } from "./account.types.js";

/**
 * Mounted at `/`. `GET /v1/me` stays with the auth module; this router adds the
 * write side of the same resource.
 */
export function createAccountRoutes({
  controller,
  sessionMiddleware,
}: AccountRoutesDeps): Hono<SessionEnv> {
  const routes = new Hono<SessionEnv>();

  routes.use("*", sessionMiddleware);

  routes.get("/v1/me/preferences", (c) => controller.getPreferences(c));

  routes.patch("/v1/me", (c) => controller.updateProfile(c));
  routes.post("/v1/me/password", (c) => controller.changePassword(c));
  routes.patch("/v1/me/preferences", (c) => controller.updatePreferences(c));
  routes.patch("/v1/me/notifications", (c) =>
    controller.updateNotifications(c),
  );

  return routes;
}
