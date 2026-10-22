import { and, desc, eq, gte, lt, sql, inArray } from "drizzle-orm";

import { db } from "../../db/client.js";
import { auditLog, project } from "../../db/schema/index.js";
import type { AuditLogFilter, AuditLogRow } from "./audit-log.types.js";
import { AUDIT_CURSOR_SEPARATOR } from "./audit-log.types.js";

function splitCursor(cursor: string): { createdAt: string; id: string } | null {
  const [createdAt, id] = cursor.split(AUDIT_CURSOR_SEPARATOR);

  if (!createdAt || !id) return null;

  return { createdAt, id };
}

export class AuditLogRepository {
  async deleteExpired(before: Date): Promise<void> {
    await db.delete(auditLog).where(lt(auditLog.createdAt, before));
  }
  /** Fetches limit + 1 rows so the caller can tell whether another page exists. */
  async list(
    organizationId: string,
    filter: AuditLogFilter,
  ): Promise<AuditLogRow[]> {
    // The tenant key is the session's workspace, never a request parameter.
    const conditions = [eq(auditLog.organizationId, organizationId)];

    if (filter.projectIds) {
      if (filter.projectIds.length === 0) return [];
      conditions.push(inArray(auditLog.projectId, filter.projectIds));
    }

    if (filter.projectId) {
      conditions.push(eq(auditLog.projectId, filter.projectId));
    }

    if (filter.environmentId) {
      conditions.push(eq(auditLog.environmentId, filter.environmentId));
    }

    if (filter.actor) {
      conditions.push(eq(auditLog.actor, filter.actor));
    }

    if (filter.action) {
      conditions.push(eq(auditLog.action, filter.action));
    }

    if (filter.from) {
      conditions.push(gte(auditLog.createdAt, filter.from));
    }

    if (filter.to) {
      conditions.push(lt(auditLog.createdAt, filter.to));
    }

    if (filter.cursor) {
      const cursor = splitCursor(filter.cursor);

      if (cursor) {
        conditions.push(
          sql`(${auditLog.createdAt}, ${auditLog.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id})`,
        );
      }
    }

    return db
      .select({
        id: auditLog.id,
        projectId: auditLog.projectId,
        projectKey: project.key,
        environmentId: auditLog.environmentId,
        action: auditLog.action,
        actor: auditLog.actor,
        actorName: auditLog.actorName,
        target: auditLog.target,
        changes: auditLog.changes,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(project, eq(project.id, auditLog.projectId))
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(filter.limit + 1);
  }
}
