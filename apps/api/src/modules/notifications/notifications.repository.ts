import {
  and,
  eq,
  inArray,
  notInArray,
  isNull,
  lt,
  or,
  desc,
  count,
} from "drizzle-orm";
import { NOTIFICATION_ACTIONS } from "@iwifunni/contracts";
import { db } from "../../db/client.js";
import {
  auditLog,
  notificationRead,
  project,
  userPreferences,
} from "../../db/schema/index.js";
import type {
  NotificationCursor,
  NotificationRow,
} from "./notifications.types.js";

export class NotificationsRepository {
  private preferenceFilter() {
    const incidents = [
      "flag.schedule_failed",
      "flag.automatically_rolled_back",
    ];
    return or(
      and(
        inArray(auditLog.action, incidents),
        or(
          isNull(userPreferences.userId),
          eq(userPreferences.notifyIncidentAlerts, true),
        ),
      ),
      and(
        notInArray(auditLog.action, incidents),
        or(
          isNull(userPreferences.userId),
          eq(userPreferences.notifyOnFlagChange, true),
        ),
      ),
    );
  }
  async list(
    organizationId: string,
    userId: string,
    projectIds: string[] | null,
    limit: number,
    cursor: NotificationCursor | null,
  ): Promise<NotificationRow[]> {
    return db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        projectName: project.name,
        createdAt: auditLog.createdAt,
        readAt: notificationRead.readAt,
      })
      .from(auditLog)
      .leftJoin(userPreferences, eq(userPreferences.userId, userId))
      .leftJoin(project, eq(project.id, auditLog.projectId))
      .leftJoin(
        notificationRead,
        and(
          eq(notificationRead.auditId, auditLog.id),
          eq(notificationRead.userId, userId),
        ),
      )
      .where(
        and(
          eq(auditLog.organizationId, organizationId),
          this.preferenceFilter(),
          inArray(auditLog.action, [...NOTIFICATION_ACTIONS]),
          projectIds ? inArray(auditLog.projectId, projectIds) : undefined,
          cursor
            ? or(
                lt(auditLog.createdAt, cursor.createdAt),
                and(
                  eq(auditLog.createdAt, cursor.createdAt),
                  lt(auditLog.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(limit + 1);
  }

  async unreadCount(
    organizationId: string,
    userId: string,
    projectIds: string[] | null,
  ): Promise<number> {
    const [row] = await db
      .select({ total: count() })
      .from(auditLog)
      .leftJoin(userPreferences, eq(userPreferences.userId, userId))
      .leftJoin(
        notificationRead,
        and(
          eq(notificationRead.auditId, auditLog.id),
          eq(notificationRead.userId, userId),
        ),
      )
      .where(
        and(
          eq(auditLog.organizationId, organizationId),
          this.preferenceFilter(),
          inArray(auditLog.action, [...NOTIFICATION_ACTIONS]),
          isNull(notificationRead.auditId),
          projectIds ? inArray(auditLog.projectId, projectIds) : undefined,
        ),
      );
    return row?.total ?? 0;
  }

  async markRead(
    organizationId: string,
    userId: string,
    projectIds: string[] | null,
    id: string,
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .leftJoin(userPreferences, eq(userPreferences.userId, userId))
      .where(
        and(
          eq(auditLog.organizationId, organizationId),
          this.preferenceFilter(),
          eq(auditLog.id, id),
          inArray(auditLog.action, [...NOTIFICATION_ACTIONS]),
          projectIds ? inArray(auditLog.projectId, projectIds) : undefined,
        ),
      )
      .limit(1);
    if (!row) return false;
    await db
      .insert(notificationRead)
      .values({ auditId: id, userId })
      .onConflictDoNothing();
    return true;
  }
}
