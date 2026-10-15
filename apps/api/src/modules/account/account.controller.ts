import {
  changePasswordSchema,
  updateNotificationsSchema,
  updatePreferencesSchema,
  updateProfileSchema,
} from "@iwifunni/contracts";
import type { Context } from "hono";

import { requireSession, requireWorkspace } from "../../middleware/authorization.js";
import { ApiError } from "../../shared/http/errors.js";
import type { SessionEnv } from "../auth/auth.types.js";
import type { AccountService } from "./account.service.js";

export class AccountController {
  constructor(private readonly service: AccountService) {}

  async updateProfile(c: Context<SessionEnv>): Promise<Response> {
    const context = await requireSession(c);
    const parsed = updateProfileSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.updateProfile(
        c.req.raw.headers,
        context.user,
        parsed.data,
      ),
    );
  }

  async changePassword(c: Context<SessionEnv>): Promise<Response> {
    await requireSession(c);

    const parsed = changePasswordSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    await this.service.changePassword(c.req.raw.headers, parsed.data);

    return c.json({ status: "ok" });
  }

  async updatePreferences(c: Context<SessionEnv>): Promise<Response> {
    const context = await requireWorkspace(c);
    const parsed = updatePreferencesSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.updatePreferences(
        context.user,
        context.workspace.id,
        parsed.data,
      ),
    );
  }

  async updateNotifications(c: Context<SessionEnv>): Promise<Response> {
    const context = await requireSession(c);
    const parsed = updateNotificationsSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.updateNotifications(context.user, parsed.data),
    );
  }

  /** `c.req.json()` throws on malformed input, which must not become a 500. */
  private async body(c: Context<SessionEnv>): Promise<unknown> {
    try {
      return await c.req.json();
    } catch {
      throw ApiError.badRequest("Send a valid JSON body.");
    }
  }

  private firstIssue(issues: ReadonlyArray<{ message: string }>): string {
    return issues[0]?.message ?? "Those account details are not valid.";
  }
}
