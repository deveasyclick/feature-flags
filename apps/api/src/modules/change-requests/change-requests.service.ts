import { randomUUID } from "node:crypto";

import {
  payloadProposesChange,
  type ProjectRole,
  type CreateFlagChangeRequestInput,
  type DecideFlagChangeRequestInput,
  type FlagChangeRequest,
  type FlagChangeRequestListQuery,
} from "@iwifunni/contracts";

import { writeAuditLog } from "../../db/audit.js";
import { db } from "../../db/client.js";
import { ApiError } from "../../shared/http/errors.js";
import { toPage } from "../../shared/pagination.js";
import type { Page } from "../../shared/types/pagination.js";
import {
  PROJECT_ROLE_RANK,
  type ProjectAccessService,
} from "../project-access/index.js";
import {
  parseChangePayload,
  toChangeRequest,
} from "./change-requests.mapper.js";
import type { ChangeRequestsRepository } from "./change-requests.repository.js";
import {
  CHANGE_REQUEST_CURSOR_SEPARATOR,
  type ChangeApplier,
  type ChangeRequestActorContext,
  type ChangeRequestCursor,
  type ChangeRequestRow,
} from "./change-requests.types.js";

/**
 * Flag changes in a protected environment, from proposal to decision.
 *
 * Two rules make the gate mean something: approving is an admin action, and it
 * must be somebody other than the author. Both are enforced here rather than in
 * the dashboard, because a client that skipped the screen would otherwise
 * approve its own change.
 */
export class ChangeRequestsService {
  constructor(
    private readonly repository: ChangeRequestsRepository,
    private readonly projectAccess: ProjectAccessService,
    /** Injected by `app.ts`, which owns the cross-module wiring. */
    private readonly applier: ChangeApplier,
  ) {}

  async list(
    context: ChangeRequestActorContext,
    projectKey: string,
    flagKey: string,
    query: FlagChangeRequestListQuery,
  ): Promise<Page<FlagChangeRequest>> {
    const { project, role } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });

    const flag = await this.requireFlag(project.id, flagKey);

    const rows = await this.repository.list(project.id, flag.id, {
      environmentKey: query.environmentKey,
      status: query.status,
      limit: query.limit,
      cursor: decodeChangeCursor(query.cursor),
    });

    const page = toPage(rows, query.limit, (row) =>
      encodeChangeCursor(row.createdAt, row.id),
    );

    return {
      data: page.data.map((row) =>
        toChangeRequest(row, this.canDecide(context, role, row)),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async create(
    context: ChangeRequestActorContext,
    projectKey: string,
    flagKey: string,
    input: CreateFlagChangeRequestInput,
  ): Promise<FlagChangeRequest> {
    const { project, role } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "engineer",
    });

    const flag = await this.requireFlag(project.id, flagKey);
    const environment = await this.requireEnvironment(
      project.id,
      input.environmentKey,
    );

    // Refused here rather than at approval, so a reviewer is never asked to
    // approve a change the API would reject anyway.
    await this.applier.validate(context, {
      projectKey,
      flagKey: flag.key,
      environmentKey: environment.key,
      payload: input.payload,
    });

    const id = randomUUID();

    await db.transaction(async (tx) => {
      await this.repository.supersedePending(tx, flag.id, environment.id);

      await this.repository.insert(tx, {
        id,
        projectId: project.id,
        environmentId: environment.id,
        flagId: flag.id,
        payload: input.payload,
        requestedBy: context.userId,
        requestedByName: context.userName,
      });

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        environmentId: environment.id,
        actor: context.userId,
        actorName: context.userName,
        action: "change_request.created",
        target: id,
        changes: {
          flagKey: flag.key,
          environment: environment.key,
          parts: proposedParts(input.payload),
        },
      });
    });

    return this.loadDetail(project.id, id, context, role);
  }

  async approve(
    context: ChangeRequestActorContext,
    projectKey: string,
    flagKey: string,
    requestId: string,
    input: DecideFlagChangeRequestInput,
  ): Promise<FlagChangeRequest> {
    const { request, projectId, role } = await this.requireDecidable(
      context,
      projectKey,
      flagKey,
      requestId,
    );

    const payload = parseChangePayload(request.payload);

    if (!payload || !payloadProposesChange(payload)) {
      throw ApiError.conflict(
        "This change request can no longer be read, so it cannot be approved. Reject it and propose the change again.",
      );
    }

    await db.transaction(async (tx) => {
      const claimed = await this.repository.decide(tx, request.id, "approved", {
        decidedBy: context.userId,
        decidedByName: context.userName,
        decisionNote: input.note ?? null,
      });

      if (!claimed) {
        throw ApiError.conflict(
          "That change request has already been decided.",
        );
      }

      // The approval and the change it authorises commit together: a change
      // whose request is still pending must never be visible.
      await this.applier.apply(tx, context, {
        projectKey,
        flagKey: request.flagKey,
        environmentKey: request.environmentKey,
        payload,
      });

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId,
        environmentId: request.environmentId,
        actor: context.userId,
        actorName: context.userName,
        action: "change_request.approved",
        target: request.id,
        changes: {
          flagKey: request.flagKey,
          environment: request.environmentKey,
          requestedBy: request.requestedBy,
          parts: proposedParts(payload),
        },
      });
    });

    return this.loadDetail(projectId, request.id, context, role);
  }

  async reject(
    context: ChangeRequestActorContext,
    projectKey: string,
    flagKey: string,
    requestId: string,
    input: DecideFlagChangeRequestInput,
  ): Promise<FlagChangeRequest> {
    const { request, projectId, role } = await this.requireDecidable(
      context,
      projectKey,
      flagKey,
      requestId,
    );

    await db.transaction(async (tx) => {
      const claimed = await this.repository.decide(tx, request.id, "rejected", {
        decidedBy: context.userId,
        decidedByName: context.userName,
        decisionNote: input.note ?? null,
      });

      if (!claimed) {
        throw ApiError.conflict(
          "That change request has already been decided.",
        );
      }

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId,
        environmentId: request.environmentId,
        actor: context.userId,
        actorName: context.userName,
        action: "change_request.rejected",
        target: request.id,
        changes: {
          flagKey: request.flagKey,
          environment: request.environmentKey,
          requestedBy: request.requestedBy,
          note: input.note ?? null,
        },
      });
    });

    return this.loadDetail(projectId, request.id, context, role);
  }

  /**
   * A request a caller is allowed to decide: it must exist in this project, be
   * pending, and not be the caller's own.
   */
  private async requireDecidable(
    context: ChangeRequestActorContext,
    projectKey: string,
    flagKey: string,
    requestId: string,
  ) {
    const { project, role } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "admin",
    });

    const flag = await this.requireFlag(project.id, flagKey);
    const request = await this.repository.findById(project.id, requestId);

    if (!request || request.flagId !== flag.id) {
      throw ApiError.notFound("Change request not found.");
    }

    if (request.status !== "pending") {
      throw ApiError.conflict(
        `That change request is already ${request.status}.`,
      );
    }

    if (request.requestedBy === context.userId) {
      throw ApiError.forbidden(
        "A change request must be approved by somebody other than the person who proposed it.",
      );
    }

    return { request, projectId: project.id, role };
  }

  private async loadDetail(
    projectId: string,
    id: string,
    context: ChangeRequestActorContext,
    role: ProjectRole,
  ): Promise<FlagChangeRequest> {
    const row = await this.repository.findById(projectId, id);

    if (!row) {
      throw ApiError.notFound("Change request not found.");
    }

    return toChangeRequest(row, this.canDecide(context, role, row));
  }

  private canDecide(
    context: ChangeRequestActorContext,
    role: ProjectRole,
    row: ChangeRequestRow,
  ): boolean {
    return (
      row.status === "pending" &&
      row.requestedBy !== context.userId &&
      PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK.admin
    );
  }

  private async requireFlag(projectId: string, flagKey: string) {
    const row = await this.repository.findFlag(projectId, flagKey);

    if (!row) {
      throw ApiError.notFound("Flag not found.");
    }

    return row;
  }

  private async requireEnvironment(projectId: string, environmentKey: string) {
    const row = await this.repository.findEnvironment(
      projectId,
      environmentKey,
    );

    if (!row) {
      throw ApiError.notFound("Environment not found.");
    }

    return row;
  }
}

/** Which halves of the environment state the proposal touches. */
function proposedParts(payload: {
  config?: unknown;
  rules?: unknown;
  targets?: unknown;
}): string[] {
  return (["config", "rules", "targets"] as const).filter(
    (part) => payload[part] !== undefined,
  );
}

function encodeChangeCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}${CHANGE_REQUEST_CURSOR_SEPARATOR}${id}`;
}

function decodeChangeCursor(
  cursor: string | undefined,
): ChangeRequestCursor | null {
  if (!cursor) return null;

  const separator = cursor.indexOf(CHANGE_REQUEST_CURSOR_SEPARATOR);

  if (separator === -1) return null;

  const createdAt = new Date(cursor.slice(0, separator));
  const id = cursor.slice(separator + CHANGE_REQUEST_CURSOR_SEPARATOR.length);

  return Number.isNaN(createdAt.getTime()) || !id ? null : { createdAt, id };
}
