export interface AuditLogRow {
  id: string;
  projectId: string | null;
  projectKey: string | null;
  environmentId: string | null;
  action: string;
  actor: string;
  actorName: string | null;
  target: string | null;
  changes: unknown;
  createdAt: Date;
}

export interface AuditLogFilter {
  projectIds?: string[] | null;
  /** Absent for the workspace-wide list. */
  projectId?: string;
  environmentId?: string;
  actor?: string;
  action?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor: string | null;
}

export interface AuditLogActorContext {
  organizationId: string;
  workspaceRole: string;
  userId: string;
}

/**
 * The list is newest first, and two rows can share a timestamp, so the cursor
 * carries both the timestamp and the id to keep paging stable.
 */
export const AUDIT_CURSOR_SEPARATOR = "::";
