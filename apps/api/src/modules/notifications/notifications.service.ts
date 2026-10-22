import {
  notificationActionSchema,
  notificationCursorSchema,
  type NotificationPage,
  type PaginationQuery,
} from "@iwifunni/contracts";
import { ApiError } from "../../shared/http/errors.js";
import { decodeCursor, toPage } from "../../shared/pagination.js";
import type { ProjectAccessService } from "../project-access/index.js";
import type { NotificationsRepository } from "./notifications.repository.js";
import {
  NOTIFICATION_TITLES,
  type NotificationActorContext,
  type NotificationCursor,
} from "./notifications.types.js";

export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}
  async list(
    context: NotificationActorContext,
    query: PaginationQuery,
  ): Promise<NotificationPage> {
    const projectIds = await this.projectAccess.visibleProjectIds(context);
    let cursor: NotificationCursor | null = null;
    const decoded = decodeCursor(query.cursor);
    if (decoded) {
      let value: unknown;
      try {
        value = JSON.parse(decoded);
      } catch {
        throw ApiError.badRequest("Invalid notification cursor.");
      }
      const parsed = notificationCursorSchema.safeParse(value);
      if (!parsed.success)
        throw ApiError.badRequest("Invalid notification cursor.");
      cursor = {
        createdAt: new Date(parsed.data.createdAt),
        id: parsed.data.id,
      };
    }
    const rows = await this.repository.list(
      context.organizationId,
      context.userId,
      projectIds,
      query.limit,
      cursor,
    );
    const page = toPage(rows, query.limit, (row) =>
      JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id }),
    );
    const unreadCount = await this.repository.unreadCount(
      context.organizationId,
      context.userId,
      projectIds,
    );
    return {
      data: page.data.map((row) => {
        const action = notificationActionSchema.parse(row.action);
        return {
          id: row.id,
          action,
          title: NOTIFICATION_TITLES[action],
          projectName: row.projectName,
          createdAt: row.createdAt.toISOString(),
          read: row.readAt !== null,
          href: "/audit-log",
        };
      }),
      nextCursor: page.nextCursor,
      unreadCount,
    };
  }
  async markRead(context: NotificationActorContext, id: string): Promise<void> {
    const ids = await this.projectAccess.visibleProjectIds(context);
    if (
      !(await this.repository.markRead(
        context.organizationId,
        context.userId,
        ids,
        id,
      ))
    )
      throw ApiError.notFound("Notification not found.");
  }
}
