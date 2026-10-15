import { randomUUID } from "node:crypto";

import {
  STARTER_ENVIRONMENTS,
  type CreateEnvironmentInput,
  type EnvironmentDetail,
  type EnvironmentSummary,
  type UpdateEnvironmentInput,
  type UpdateEnvironmentSettingsInput,
} from "@iwifunni/contracts";

import { writeAuditLog } from "../../db/audit.js";
import { db } from "../../db/client.js";
import { ApiError } from "../../shared/http/errors.js";
import { decodeCursor, toPage } from "../../shared/pagination.js";
import type { Page } from "../../shared/types/pagination.js";
import type { Transaction } from "../../shared/types/db.js";
import type { ProjectAccessService } from "../project-access/index.js";
import {
  toEnvironmentDetail,
  toEnvironmentSummary,
} from "./environments.mapper.js";
import type { EnvironmentsRepository } from "./environments.repository.js";
import {
  toEnvironmentRef,
  type InitializeEnvironmentConfigs,
  type EnvironmentActorContext,
  type EnvironmentConnectionUrls,
  type EnvironmentDetails,
  type EnvironmentRow,
} from "./environments.types.js";

/**
 * Reads are viewer-level; creating or reconfiguring an environment needs the
 * project admin role docs/architecture.md
 */
export class EnvironmentsService {
  constructor(
    private readonly repository: EnvironmentsRepository,
    private readonly projectAccess: ProjectAccessService,
    /** Injected by `app.ts` so environments never imports the flags module. */
    private readonly initializeConfigs: InitializeEnvironmentConfigs,
  ) {}

  async list(
    context: EnvironmentActorContext,
    projectKey: string,
    limit: number,
    cursor: string | undefined,
    includeArchived: boolean,
  ): Promise<Page<EnvironmentSummary>> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });

    const rows = await this.repository.list(
      project.id,
      limit,
      decodeCursor(cursor),
      includeArchived,
    );
    const page = toPage(rows, limit, (row) => row.key);

    return {
      data: page.data.map(toEnvironmentSummary),
      nextCursor: page.nextCursor,
    };
  }

  async create(
    context: EnvironmentActorContext,
    projectKey: string,
    input: CreateEnvironmentInput,
    origin: string,
  ): Promise<EnvironmentDetail> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "admin",
    });

    if (await this.repository.findByKey(project.id, input.key)) {
      throw ApiError.conflict("An environment with that key already exists.");
    }

    // Resolved before anything is written: copying from an environment that
    // does not exist has to fail the request, not half-create a new one.
    const source = input.copyFrom
      ? await this.requireEnvironment(project.id, input.copyFrom)
      : null;

    const existing = await this.repository.countForProject(project.id);

    const id = randomUUID();

    await db.transaction(async (tx) => {
      await this.repository.insert(tx, {
        id,
        projectId: project.id,
        key: input.key,
        name: input.name,
        color: input.color ?? null,
        isDefault: existing === 0,
        isProtected: false,
      });

      // Every flag of the project gets a configuration here: disabled defaults,
      // or a copy of each configuration from the environment the caller named.
      const configuredFlags = await this.initializeConfigs(tx, {
        projectId: project.id,
        source: source ? toEnvironmentRef(source) : null,
        target: {
          id,
          key: input.key,
          name: input.name,
          isProtected: false,
          archivedAt: null,
        },
        author: context.userId,
      });

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "environment.created",
        target: id,
        changes: {
          key: input.key,
          name: input.name,
          initialFlagStatus: input.initialFlagStatus,
          copyFrom: source?.key ?? null,
          configuredFlags,
        },
      });
    });

    return this.loadDetail(project.id, input.key, origin);
  }

  async get(
    context: EnvironmentActorContext,
    projectKey: string,
    environmentKey: string,
    origin: string,
  ): Promise<EnvironmentDetail> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });

    return this.loadDetail(project.id, environmentKey, origin);
  }

  async updateSettings(
    context: EnvironmentActorContext,
    projectKey: string,
    environmentKey: string,
    input: UpdateEnvironmentSettingsInput,
    origin: string,
  ): Promise<EnvironmentDetail> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "admin",
    });

    const row = await this.requireEnvironment(project.id, environmentKey);
    this.assertActive(row);

    await db.transaction(async (tx) => {
      await this.repository.setProtected(tx, row.id, input.isProtected);

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        environmentId: row.id,
        actor: context.userId,
        actorName: context.userName,
        action: "environment.updated",
        target: row.id,
        changes: input,
      });
    });

    return this.loadDetail(project.id, environmentKey, origin);
  }

  async update(
    context: EnvironmentActorContext,
    projectKey: string,
    environmentKey: string,
    input: UpdateEnvironmentInput,
    origin: string,
  ): Promise<EnvironmentDetail> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "admin",
    });

    const row = await this.requireEnvironment(project.id, environmentKey);
    this.assertActive(row);

    const details: EnvironmentDetails = {
      name: input.name,
      // An absent description means "leave it"; an empty one means "clear it".
      description:
        input.description === undefined
          ? row.description
          : input.description || null,
    };

    await db.transaction(async (tx) => {
      await this.repository.updateDetails(tx, row.id, details);

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        environmentId: row.id,
        actor: context.userId,
        actorName: context.userName,
        action: "environment.updated",
        target: row.id,
        changes: details,
      });
    });

    return this.loadDetail(project.id, environmentKey, origin);
  }

  /**
   * Archiving is the reversible half of deletion: configuration is preserved
   * and the environment's own credentials stop working. The active count is
   * read inside the transaction so two concurrent archives cannot empty a
   * project of environments.
   */
  async archive(
    context: EnvironmentActorContext,
    projectKey: string,
    environmentKey: string,
    origin: string,
  ): Promise<EnvironmentDetail> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "admin",
    });

    const row = await this.requireEnvironment(project.id, environmentKey);

    if (row.archivedAt) {
      throw ApiError.conflict("That environment is already archived.");
    }

    await db.transaction(async (tx) => {
      const active = await this.repository.listActiveInTransaction(
        tx,
        project.id,
      );

      if (active.length <= 1) {
        throw ApiError.conflict(
          "A project must have at least one active environment.",
        );
      }

      const revokedKeys = await this.repository.revokeKeysForEnvironment(
        tx,
        row.id,
      );

      await this.repository.setArchived(tx, row.id, new Date());

      // The default badge follows the project, so it never stays on an
      // archived environment while an active one could carry it.
      const successor = active.find((entry) => entry.id !== row.id);

      if (row.isDefault && successor) {
        await this.repository.setDefault(tx, row.id, false);
        await this.repository.setDefault(tx, successor.id, true);
      }

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        environmentId: row.id,
        actor: context.userId,
        actorName: context.userName,
        action: "environment.archived",
        target: row.id,
        changes: { key: row.key, revokedKeys },
      });
    });

    return this.loadDetail(project.id, environmentKey, origin);
  }

  /** Restoring is not a rollback: keys revoked by the archive stay revoked. */
  async unarchive(
    context: EnvironmentActorContext,
    projectKey: string,
    environmentKey: string,
    origin: string,
  ): Promise<EnvironmentDetail> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "admin",
    });

    const row = await this.requireEnvironment(project.id, environmentKey);

    if (!row.archivedAt) {
      throw ApiError.conflict("That environment is not archived.");
    }

    await db.transaction(async (tx) => {
      await this.repository.setArchived(tx, row.id, null);

      // Every flag is configured when either it or the environment is created,
      // so this normally writes nothing: it repairs an environment that was
      // archived before a flag existed.
      await this.initializeConfigs(tx, {
        projectId: project.id,
        source: null,
        target: toEnvironmentRef({ ...row, archivedAt: null }),
        author: context.userId,
      });

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        environmentId: row.id,
        actor: context.userId,
        actorName: context.userName,
        action: "environment.unarchived",
        target: row.id,
        changes: { key: row.key },
      });
    });

    return this.loadDetail(project.id, environmentKey, origin);
  }

  async createStarterEnvironments(
    tx: Transaction,
    projectId: string,
  ): Promise<void> {
    for (const [index, starter] of STARTER_ENVIRONMENTS.entries()) {
      await this.repository.insert(tx, {
        id: randomUUID(),
        projectId,
        key: starter.key,
        name: starter.name,
        color: starter.color,
        isDefault: index === 0,
        isProtected: false,
      });
    }
  }

  private async loadDetail(
    projectId: string,
    environmentKey: string,
    origin: string,
  ): Promise<EnvironmentDetail> {
    const row = await this.requireEnvironment(projectId, environmentKey);
    const prefix = await this.repository.findUsableKeyPrefix(projectId, row.id);

    const connection: EnvironmentConnectionUrls = {
      baseUrl: origin,
      evalUrl: `${origin}/v1/evaluate`,
      // Streaming is not implemented; the contract keeps this null until it is.
      streamUrl: null,
      maskedKey: prefix,
    };

    return toEnvironmentDetail(row, connection);
  }

  private async requireEnvironment(projectId: string, key: string) {
    const row = await this.repository.findByKey(projectId, key);

    if (!row) {
      throw ApiError.notFound("Environment not found.");
    }

    return row;
  }

  private assertActive(row: EnvironmentRow): void {
    if (row.archivedAt) {
      throw ApiError.conflict(
        "That environment is archived. Unarchive it before making changes.",
      );
    }
  }
}
