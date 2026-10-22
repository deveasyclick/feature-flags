import { randomUUID } from "node:crypto";

import {
  toWorkspaceSlug,
  type CreateProjectInput,
  type Project,
  type ProjectListQuery,
  type UpdateProjectInput,
  type TransferProjectInput,
} from "@iwifunni/contracts";

import { writeAuditLog } from "../../db/audit.js";
import { db } from "../../db/client.js";
import { ApiError } from "../../shared/http/errors.js";
import type { Transaction } from "../../shared/types/db.js";
import type { ProjectAccessService } from "../project-access/index.js";
import { toProject } from "./projects.mapper.js";
import type { ProjectsRepository } from "./projects.repository.js";
import type {
  ProjectRow,
  ProjectsActorContext,
  StarterEnvironmentsCreator,
} from "./projects.types.js";

/** Bounded so a crowded namespace fails fast instead of probing forever. */
const MAX_KEY_SUFFIX = 50;

export class ProjectsService {
  constructor(
    private readonly repository: ProjectsRepository,
    private readonly createStarterEnvironments: StarterEnvironmentsCreator,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async archive(
    context: ProjectsActorContext,
    projectKey: string,
  ): Promise<void> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "owner",
    });
    await db.transaction(async (tx) => {
      await this.repository.archive(tx, context.organizationId, project.id);
      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "project.archived",
        target: project.id,
      });
    });
  }

  async restore(
    context: ProjectsActorContext,
    projectKey: string,
  ): Promise<Project> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "owner",
      allowArchived: true,
    });
    if (!project.archivedAt)
      throw ApiError.conflict("The project is not archived.");
    await db.transaction(async (tx) => {
      await this.repository.update(tx, project.id, { archivedAt: null });
      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "project.restored",
        target: project.id,
      });
    });
    return this.get(context, projectKey);
  }

  async duplicate(
    context: ProjectsActorContext,
    projectKey: string,
    input: CreateProjectInput,
  ): Promise<ProjectRow> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "owner",
    });
    return db.transaction(
      async (tx) => {
        const created = await this.copyProject(
          tx,
          project.id,
          context.organizationId,
          input.name,
          context,
        );
        await writeAuditLog(tx, {
          organizationId: context.organizationId,
          projectId: created.id,
          actor: context.userId,
          actorName: context.userName,
          action: "project.duplicated",
          target: created.id,
          changes: { sourceProjectKey: project.key },
        });
        return created;
      },
      { isolationLevel: "repeatable read" },
    );
  }

  async transfer(
    context: ProjectsActorContext,
    projectKey: string,
    input: TransferProjectInput,
  ): Promise<ProjectRow> {
    if (context.workspaceRole !== "owner")
      throw ApiError.forbidden(
        "Only a workspace owner can transfer a project.",
      );
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "owner",
    });
    const destination = await this.repository.findOwnedDestination(
      context.userId,
      input.destinationWorkspaceSlug,
    );
    if (!destination)
      throw ApiError.notFound("Destination workspace not found.");
    if (destination.id === context.organizationId)
      throw ApiError.badRequest("Choose a different workspace.");
    return db.transaction(
      async (tx) => {
        const created = await this.copyProject(
          tx,
          project.id,
          destination.id,
          project.name,
          context,
        );
        await this.repository.archive(tx, context.organizationId, project.id);
        await writeAuditLog(tx, {
          organizationId: context.organizationId,
          projectId: project.id,
          actor: context.userId,
          actorName: context.userName,
          action: "project.transferred",
          target: project.id,
          changes: {
            destinationWorkspaceSlug: destination.slug,
            destinationProjectKey: created.key,
          },
        });
        await writeAuditLog(tx, {
          organizationId: destination.id,
          projectId: created.id,
          actor: context.userId,
          actorName: context.userName,
          action: "project.transferred",
          target: created.id,
          changes: { sourceProjectKey: project.key },
        });
        return created;
      },
      { isolationLevel: "repeatable read" },
    );
  }

  private async copyProject(
    tx: Transaction,
    sourceId: string,
    destinationId: string,
    name: string,
    context: ProjectsActorContext,
  ): Promise<ProjectRow> {
    const key = await this.resolveKey(tx, destinationId, name);
    const created = { id: randomUUID(), key, name };
    await this.repository.insert(tx, {
      ...created,
      organizationId: destinationId,
    });
    await this.repository.insertOwner(tx, {
      id: randomUUID(),
      projectId: created.id,
      userId: context.userId,
    });
    await this.repository.cloneConfiguration(
      tx,
      sourceId,
      created.id,
      context.userId,
    );
    return created;
  }

  async list(
    context: ProjectsActorContext,
    query: ProjectListQuery,
  ): Promise<Project[]> {
    const ids = await this.projectAccess.visibleProjectIds(context);
    const rows = await this.repository.list(
      context.organizationId,
      query.search,
      ids,
      query.includeArchived ?? false,
    );

    return rows.map(toProject);
  }

  async get(
    context: ProjectsActorContext,
    projectKey: string,
  ): Promise<Project> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
      allowArchived: true,
    });

    const row = await this.repository.findDetailByKey(
      context.organizationId,
      project.key,
    );

    if (!row) {
      throw ApiError.notFound("Project not found.");
    }

    return toProject(row);
  }

  /** Renaming and reconfiguring a project is owner-level per docs/architecture.md §3. */
  async update(
    context: ProjectsActorContext,
    projectKey: string,
    input: UpdateProjectInput,
  ): Promise<Project> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "owner",
    });

    let defaultEnvironmentId: string | null | undefined;

    if (input.defaultEnvironmentKey !== undefined) {
      if (input.defaultEnvironmentKey === null) {
        defaultEnvironmentId = null;
      } else {
        const environment = await this.repository.findEnvironmentByKey(
          project.id,
          input.defaultEnvironmentKey,
        );

        if (!environment) {
          throw ApiError.badRequest(
            `"${input.defaultEnvironmentKey}" is not an environment of this project.`,
          );
        }

        defaultEnvironmentId = environment.id;
      }
    }

    await db.transaction(async (tx) => {
      await this.repository.update(tx, project.id, {
        name: input.name,
        description: input.description,
        color: input.color,
        ownerTeam: input.ownerTeam,
        defaultEnvironmentId,
      });

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "project.updated",
        target: project.id,
        changes: input,
      });
    });

    const row = await this.repository.findDetailByKey(
      context.organizationId,
      projectKey,
    );

    if (!row) {
      throw ApiError.notFound("Project not found.");
    }

    return toProject(row);
  }

  async create(
    context: ProjectsActorContext,
    input: CreateProjectInput,
  ): Promise<ProjectRow> {
    return db.transaction(async (tx) => {
      const key = await this.resolveKey(tx, context.organizationId, input.name);

      const created = {
        id: randomUUID(),
        key,
        name: input.name,
      };

      await this.repository.insert(tx, {
        organizationId: context.organizationId,
        ...created,
      });

      await this.repository.insertOwner(tx, {
        id: randomUUID(),
        projectId: created.id,
        userId: context.userId,
      });

      // Same transaction: a project with no environment cannot hold a flag, and
      // onboarding is the only path to a populated dashboard.
      await this.createStarterEnvironments(tx, created.id);

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        actor: context.userId,
        actorName: context.userName,
        action: "project.created",
        projectId: created.id,
        target: created.id,
        changes: created,
      });

      return created;
    });
  }

  async hasProject(organizationId: string): Promise<boolean> {
    return (await this.repository.countForOrganization(organizationId)) > 0;
  }

  /** Derives a workspace-unique key, suffixing rather than failing. */
  private async resolveKey(
    tx: Transaction,
    organizationId: string,
    name: string,
  ): Promise<string> {
    const base = toWorkspaceSlug(name) || "project";

    if (!(await this.repository.findByKey(tx, organizationId, base))) {
      return base;
    }

    for (let suffix = 2; suffix <= MAX_KEY_SUFFIX; suffix += 1) {
      const candidate = `${base}-${suffix}`;

      if (!(await this.repository.findByKey(tx, organizationId, candidate))) {
        return candidate;
      }
    }

    throw ApiError.badRequest(
      "Too many projects share that name. Choose a different one.",
    );
  }
}
