import { Hono } from "hono";
import type { AuthRoutesDeps, SessionEnv } from "./auth.types.js";
import { ApiError } from "../../shared/http/errors.js";

export function createAuthRoutes({
  controller,
  sessionMiddleware,
  authHandler,
}: AuthRoutesDeps): Hono<SessionEnv> {
  const routes = new Hono<SessionEnv>();

  // Better Auth owns `/api/auth/*`; we only forward the raw request.
  routes.all("/api/auth/*", sessionMiddleware, async (c) => {
    const context = c.get("session");
    const path = decodeURIComponent(c.req.path)
      .replace(/\/+/g, "/")
      .replace(/\/+$/, "");
    const verifying =
      path === "/api/auth/two-factor/verify-totp" ||
      path === "/api/auth/two-factor/verify-backup-code";
    const passive =
      path === "/api/auth/get-session" || path === "/api/auth/sign-out";
    if (context?.mfaRequired && !verifying && !passive)
      throw ApiError.mfaRequired();
    if (
      context?.mfaEnrollmentRequired &&
      path !== "/api/auth/two-factor/enable" &&
      !verifying &&
      !passive
    )
      throw ApiError.mfaEnrollmentRequired();
    if (
      context?.workspace?.requireTwoFactor &&
      path === "/api/auth/two-factor/disable"
    )
      throw ApiError.forbidden(
        "Your workspace requires two-factor authentication.",
      );
    const response = await authHandler(c.req.raw);
    await controller.recordFactorVerification(c.req.raw, response);
    return response;
  });

  routes.get("/v1/auth/providers", (c) => controller.providers(c));

  routes.get("/v1/me", sessionMiddleware, (c) => controller.me(c));

  return routes;
}
