import type { AuditAction, AuditLogEntry } from "@iwifunni/contracts";

import type { AuditLogRow } from "./audit-log.types.js";

/** Absolute ISO timestamps only: labels are the dashboard's job. */
export function toAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    projectId: row.projectId,
    projectKey: row.projectKey,
    environmentId: row.environmentId,
    action: row.action as AuditAction,
    actor: row.actor,
    actorName: row.actorName,
    target: row.target,
    changes: row.changes ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
