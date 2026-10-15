import { randomUUID } from "node:crypto";

import type {
  CreateSegmentInput,
  SegmentDetail,
  SegmentFlag,
  SegmentListQuery,
  SegmentSummary,
  UpdateSegmentInput,
} from "@iwifunni/contracts";

import { writeAuditLog } from "../../db/audit.js";
import { db } from "../../db/client.js";
import { ApiError } from "../../shared/http/errors.js";
import { decodeCursor, toPage } from "../../shared/pagination.js";
import type { Page } from "../../shared/types/pagination.js";
import type { ProjectAccessService } from "../project-access/index.js";
import {
  toSegmentDetail,
  toSegmentFlags,
  toSegmentSummary,
} from "./segments.mapper.js";
import type { SegmentsRepository } from "./segments.repository.js";
import type { SegmentActorContext } from "./segments.types.js";

/**
 * Reads are viewer-level; creating, editing and archiving a segment is
 * engineer-level per docs/architecture.md §3.
 */
export class SegmentsService {
  constructor(
    private readonly repository: SegmentsRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async list(
    context: SegmentActorContext,
    projectKey: string,
    query: SegmentListQuery,
  ): Promise<Page<SegmentSummary>> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });

    const rows = await this.repository.list(project.id, {
      search: query.search,
      includeArchived: query.includeArchived ?? false,
      limit: query.limit,
      cursor: decodeCursor(query.cursor),
    });

    const page = toPage(rows, query.limit, (row) => row.key);
    const counts = await this.repository.countConditions(
      page.data.map((row) => row.id),
    );

    return {
      data: page.data.map((row) =>
        toSegmentSummary(
          row,
          counts.find((entry) => entry.segmentId === row.id)?.count ?? 0,
        ),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async create(
    context: SegmentActorContext,
    projectKey: string,
    input: CreateSegmentInput,
  ): Promise<SegmentDetail> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "engineer",
    });

    if (await this.repository.findByKey(project.id, input.key)) {
      throw ApiError.conflict("A segment with that key already exists.");
    }

    const id = randomUUID();

    await db.transaction(async (tx) => {
      await this.repository.insert(tx, {
        id,
        projectId: project.id,
        key: input.key,
        name: input.name,
        description: input.description ?? null,
      });

      await this.repository.replaceConditions(tx, id, input.rules);

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "segment.created",
        target: id,
        changes: { key: input.key, name: input.name, rules: input.rules },
      });
    });

    return this.loadDetail(project.id, input.key);
  }

  async get(
    context: SegmentActorContext,
    projectKey: string,
    segmentKey: string,
  ): Promise<SegmentDetail> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });

    return this.loadDetail(project.id, segmentKey);
  }

  async update(
    context: SegmentActorContext,
    projectKey: string,
    segmentKey: string,
    input: UpdateSegmentInput,
  ): Promise<SegmentDetail> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "engineer",
    });

    const row = await this.requireSegment(project.id, segmentKey);

    await db.transaction(async (tx) => {
      await this.repository.update(tx, row.id, {
        name: input.name,
        description: input.description,
      });

      if (input.rules) {
        await this.repository.replaceConditions(tx, row.id, input.rules);
      }

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "segment.updated",
        target: row.id,
        changes: {
          name: input.name,
          description: input.description,
          rules: input.rules,
        },
      });
    });

    return this.loadDetail(project.id, segmentKey);
  }

  async archive(
    context: SegmentActorContext,
    projectKey: string,
    segmentKey: string,
  ): Promise<{ key: string; archivedAt: string }> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "engineer",
    });

    const row = await this.requireSegment(project.id, segmentKey);

    return db.transaction(async (tx) => {
      const archivedAt = await this.repository.archive(tx, row.id);

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "segment.archived",
        target: row.id,
        changes: { key: row.key },
      });

      return { key: row.key, archivedAt: archivedAt.toISOString() };
    });
  }

  async listFlags(
    context: SegmentActorContext,
    projectKey: string,
    segmentKey: string,
  ): Promise<SegmentFlag[]> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });

    await this.requireSegment(project.id, segmentKey);

    const rows = await this.repository.listFlagsReferencing(
      project.id,
      segmentKey,
    );

    return toSegmentFlags(rows);
  }

  /**
   * Which of these keys are not segments of the project. Used by the flags
   * module through an injected callback, after its own gate has already run, so
   * a targeting rule can only reference a real segment.
   */
  async findUnknownKeys(
    projectId: string,
    keys: string[],
  ): Promise<string[]> {
    if (keys.length === 0) return [];

    const found = await this.repository.findManyByKeys(projectId, keys);
    const known = new Set(found.map((row) => row.key));

    return keys.filter((key) => !known.has(key));
  }

  private async loadDetail(
    projectId: string,
    segmentKey: string,
  ): Promise<SegmentDetail> {
    const row = await this.requireSegment(projectId, segmentKey);
    const conditions = await this.repository.listConditions(row.id);

    return toSegmentDetail(row, conditions);
  }

  private async requireSegment(projectId: string, key: string) {
    const row = await this.repository.findByKey(projectId, key);

    if (!row) {
      throw ApiError.notFound("Segment not found.");
    }

    return row;
  }
}
