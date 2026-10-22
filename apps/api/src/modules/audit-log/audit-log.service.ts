import type { AuditLogEntry, AuditLogQuery } from "@iwifunni/contracts";

import { ApiError } from "../../shared/http/errors.js";
import { decodeCursor, toPage } from "../../shared/pagination.js";
import type { Page } from "../../shared/types/pagination.js";
import type { ProjectAccessService } from "../project-access/index.js";
import { toAuditLogEntry } from "./audit-log.mapper.js";
import type { AuditLogRepository } from "./audit-log.repository.js";
import {
  AUDIT_CURSOR_SEPARATOR,
  type AuditLogActorContext,
} from "./audit-log.types.js";

/**
 * Read-only: the rows are written by each module inside its own mutation
 * transaction. Viewer-level access is enough for both lists.
 */
export class AuditLogService {
  async retain(): Promise<void> {
    await this.repository.deleteExpired(new Date(Date.now() - 90 * 86_400_000));
  }
  constructor(
    private readonly repository: AuditLogRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async listForProject(
    context: AuditLogActorContext,
    projectKey: string,
    query: AuditLogQuery,
  ): Promise<Page<AuditLogEntry>> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });

    return this.page(context.organizationId, query, { projectId: project.id });
  }

  /** The global screen renders outside a project, so it spans the workspace. */
  async listForWorkspace(
    context: AuditLogActorContext,
    query: AuditLogQuery,
  ): Promise<Page<AuditLogEntry>> {
    return this.page(context.organizationId, query, {
      projectIds: await this.projectAccess.visibleProjectIds(context),
    });
  }

  private async page(
    organizationId: string,
    query: AuditLogQuery,
    scope: { projectId?: string; projectIds?: string[] | null },
  ): Promise<Page<AuditLogEntry>> {
    const rows = await this.repository.list(organizationId, {
      ...scope,
      environmentId: query.environmentId,
      actor: query.actor,
      action: query.action,
      from: parseTimestamp(query.from, "from"),
      to: parseTimestamp(query.to, "to"),
      limit: query.limit,
      cursor: decodeCursor(query.cursor),
    });

    const page = toPage(
      rows,
      query.limit,
      (row) =>
        `${row.createdAt.toISOString()}${AUDIT_CURSOR_SEPARATOR}${row.id}`,
    );

    return {
      data: page.data.map(toAuditLogEntry),
      nextCursor: page.nextCursor,
    };
  }
}

function parseTimestamp(
  value: string | undefined,
  field: string,
): Date | undefined {
  if (!value) return undefined;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw ApiError.badRequest(`\`${field}\` must be an ISO-8601 timestamp.`);
  }

  return parsed;
}
