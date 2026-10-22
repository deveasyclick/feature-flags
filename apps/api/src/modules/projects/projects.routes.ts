import { Hono } from "hono";

import type { SessionEnv } from "../auth/auth.types.js";
import type { ProjectsRoutesDeps } from "./projects.types.js";

export function createProjectsRoutes({
  controller,
  sessionMiddleware,
}: ProjectsRoutesDeps): Hono<SessionEnv> {
  const routes = new Hono<SessionEnv>();

  routes.use("*", sessionMiddleware);

  routes.get("/", (c) => controller.list(c));
  routes.post("/", (c) => controller.create(c));
  routes.get("/:projectKey", (c) => controller.get(c));
  routes.patch("/:projectKey", (c) => controller.update(c));
  routes.post("/:projectKey/archive", (c) => controller.archive(c));
  routes.post("/:projectKey/restore", (c) => controller.restore(c));
  routes.post("/:projectKey/duplicate", (c) => controller.duplicate(c));
  routes.post("/:projectKey/transfer", (c) => controller.transfer(c));

  return routes;
}
