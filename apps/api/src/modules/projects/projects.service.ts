import { randomUUID } from "node:crypto";

import {
  toWorkspaceSlug,
  type CreateProjectInput,
  type Project,
  type ProjectListQuery,
  type UpdateProjectInput,
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

  async list(
    organizationId: string,
    query: ProjectListQuery,
  ): Promise<Project[]> {
    const rows = await this.repository.list(organizationId, query.search);

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
