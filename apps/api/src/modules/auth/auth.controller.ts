import type { Context } from "hono";

import { requireSession } from "../../middleware/authorization.js";
import type { AuthService } from "./auth.service.js";
import type { SessionEnv } from "./auth.types.js";

export class AuthController {
  constructor(private readonly service: AuthService) {}

  async recordFactorVerification(
    request: Request,
    response: Response,
  ): Promise<void> {
    if (
      !response.ok ||
      ![
        "/api/auth/two-factor/verify-totp",
        "/api/auth/two-factor/verify-backup-code",
      ].includes(new URL(request.url).pathname.replace(/\/+$/, ""))
    )
      return;
    const cookies = new Map(
      (request.headers.get("cookie") ?? "")
        .split(";")
        .filter(Boolean)
        .map((cookie) => {
          const index = cookie.indexOf("=");
          return [cookie.slice(0, index).trim(), cookie.slice(index + 1)];
        }),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      if (!pair) continue;
      const index = pair.indexOf("=");
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const headers = new Headers(request.headers);
    headers.set(
      "cookie",
      [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
    );
    await this.service.verifySessionFactor(headers);
  }

  providers(c: Context<SessionEnv>): Response {
    return c.json({ enabled: this.service.providersForDeployment() });
  }

  /** The session middleware has already resolved the context by this point. */
  async me(c: Context<SessionEnv>): Promise<Response> {
    const context = await requireSession(c, true);

    return c.json({
      user: context.user,
      workspace: context.workspace
        ? {
            id: context.workspace.id,
            name: context.workspace.name,
            slug: context.workspace.slug,
            role: context.workspace.role,
          }
        : null,
      hasProject: context.hasProject,
      mfaRequired: context.mfaRequired ?? false,
      mfaEnrollmentRequired: context.mfaEnrollmentRequired ?? false,
      providers: { enabled: this.service.providersForDeployment() },
    });
  }
}
