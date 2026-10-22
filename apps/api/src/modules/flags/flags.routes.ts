import { Hono } from "hono";

import type { SessionEnv } from "../auth/auth.types.js";
import type { FlagsRoutesDeps } from "./flags.types.js";

/**
 * Mounted at `/`, because the module owns both the workspace-wide `/v1/flags`
 * list and the project-scoped flag paths.
 *
 * A flag is addressed inside the project it belongs to: its key is unique there.
 * What it does in one environment hangs off the flag under `environments/`.
 */
export function createFlagsRoutes({
  controller,
  sessionMiddleware,
}: FlagsRoutesDeps): Hono<SessionEnv> {
  const routes = new Hono<SessionEnv>();

  routes.use("*", sessionMiddleware);

  routes.get("/v1/flags", (c) => controller.listWorkspace(c));
  routes.get("/v1/flags/:flagKey", (c) => controller.resolve(c));

  routes.get("/v1/projects/:projectKey/flags", (c) => controller.list(c));
  routes.post("/v1/projects/:projectKey/flags", (c) => controller.create(c));

  const flagPath = "/v1/projects/:projectKey/flags/:flagKey";
  const configPath = `${flagPath}/environments/:environmentKey`;

  routes.get(flagPath, (c) => controller.get(c));
  routes.get(`${flagPath}/client-visibility`, (c) =>
    controller.clientVisibility(c),
  );
  routes.patch(`${flagPath}/client-visibility`, (c) =>
    controller.setClientVisibility(c),
  );
  routes.patch(flagPath, (c) => controller.update(c));
  routes.delete(flagPath, (c) => controller.archive(c));
  routes.post(`${flagPath}/unarchive`, (c) => controller.unarchive(c));

  routes.get(`${flagPath}/variations`, (c) => controller.getVariations(c));
  routes.post(`${flagPath}/variations`, (c) => controller.addVariation(c));
  routes.patch(`${flagPath}/variations/:variationKey`, (c) =>
    controller.updateVariation(c),
  );
  routes.delete(`${flagPath}/variations/:variationKey`, (c) =>
    controller.removeVariation(c),
  );

  routes.get(configPath, (c) => controller.getEnvironmentConfig(c));
  routes.patch(configPath, (c) => controller.updateEnvironmentConfig(c));
  routes.patch(`${configPath}/enabled`, (c) =>
    controller.setEnvironmentEnabled(c),
  );

  routes.get(`${configPath}/rules`, (c) => controller.getRules(c));
  routes.put(`${configPath}/rules`, (c) => controller.replaceRules(c));

  routes.get(`${configPath}/targets`, (c) => controller.getTargets(c));
  routes.put(`${configPath}/targets`, (c) => controller.replaceTargets(c));

  routes.put(`${configPath}/targeting`, (c) => controller.publishTargeting(c));

  routes.get(`${configPath}/versions`, (c) => controller.listVersions(c));
  routes.get(`${configPath}/schedules`, (c) => controller.listSchedules(c));
  routes.get(`${configPath}/rollback-policies`, (c) =>
    controller.listRollbacks(c),
  );
  routes.post(`${configPath}/rollback-policies`, (c) =>
    controller.armRollback(c),
  );
  routes.delete(`${configPath}/rollback-policies/:policyId`, (c) =>
    controller.cancelRollback(c),
  );
  routes.post(`${configPath}/schedules`, (c) => controller.scheduleChange(c));
  routes.delete(`${configPath}/schedules/:scheduleId`, (c) =>
    controller.cancelSchedule(c),
  );
  routes.get(`${configPath}/versions/:version`, (c) =>
    controller.getVersion(c),
  );
  routes.post(`${configPath}/versions/:version/restore`, (c) =>
    controller.restoreVersion(c),
  );

  routes.get(`${flagPath}/dependencies`, (c) => controller.getDependencies(c));

  return routes;
}
