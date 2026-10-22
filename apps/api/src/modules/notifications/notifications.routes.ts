import { Hono, type MiddlewareHandler } from "hono";
import type { SessionEnv } from "../auth/index.js";
import type { NotificationsController } from "./notifications.controller.js";

export function createNotificationsRoutes(
  controller: NotificationsController,
  sessionMiddleware: MiddlewareHandler,
): Hono<SessionEnv> {
  const routes = new Hono<SessionEnv>();
  routes.use("*", sessionMiddleware);
  routes.get("/", (c) => controller.list(c));
  routes.post("/:id/read", (c) => controller.markRead(c));
  return routes;
}
