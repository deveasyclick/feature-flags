import {
  notificationListQuerySchema,
  notificationIdSchema,
} from "@iwifunni/contracts";
import type { Context } from "hono";
import { requireWorkspace } from "../../middleware/authorization.js";
import { ApiError } from "../../shared/http/errors.js";
import type { SessionEnv } from "../auth/index.js";
import type { NotificationsService } from "./notifications.service.js";
import type { NotificationActorContext } from "./notifications.types.js";

export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}
  async list(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = notificationListQuerySchema.safeParse(c.req.query());
    if (!parsed.success)
      throw ApiError.badRequest(
        parsed.error.issues[0]?.message ?? "Invalid notification query.",
      );
    c.header("Cache-Control", "no-store");
    return c.json(await this.service.list(actor, parsed.data));
  }
  async markRead(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = notificationIdSchema.safeParse(c.req.param("id"));
    if (!parsed.success)
      throw ApiError.badRequest("Invalid notification identifier.");
    await this.service.markRead(actor, parsed.data);
    return c.body(null, 204);
  }
  private async actor(
    c: Context<SessionEnv>,
  ): Promise<NotificationActorContext> {
    const context = await requireWorkspace(c);
    return {
      organizationId: context.workspace.id,
      workspaceRole: context.workspace.role,
      userId: context.user.id,
    };
  }
}
