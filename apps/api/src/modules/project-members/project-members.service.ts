import { randomUUID } from "node:crypto";

import type {
  AddProjectMemberInput,
  ProjectMember,
  ProjectRole,
  UpdateProjectMemberInput,
} from "@iwifunni/contracts";

import { writeAuditLog } from "../../db/audit.js";
import { db } from "../../db/client.js";
import { ApiError } from "../../shared/http/errors.js";
import type { ProjectAccessService } from "../project-access/index.js";
import type { ProjectMembersRepository } from "./project-members.repository.js";
import type {
  ProjectMemberActorContext,
  ProjectMemberRow,
} from "./project-members.types.js";

function toProjectMember(row: ProjectMemberRow): ProjectMember {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role as ProjectRole,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Membership is admin-level per docs/architecture.md §3. A workspace owner or
 * admin is an implicit project admin, so the gate already covers them.
 */
export class ProjectMembersService {
  constructor(
    private readonly repository: ProjectMembersRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async list(
    context: ProjectMemberActorContext,
    projectKey: string,
  ): Promise<ProjectMember[]> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });

    return (await this.repository.list(project.id)).map(toProjectMember);
  }

  async add(
    context: ProjectMemberActorContext,
    projectKey: string,
    input: AddProjectMemberInput,
  ): Promise<ProjectMember> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "admin",
    });

    if (!(await this.repository.isWorkspaceMember(context.organizationId, input.userId))) {
      throw ApiError.badRequest(
        "That person is not a member of this workspace.",
      );
    }

    if (await this.repository.find(project.id, input.userId)) {
      throw ApiError.conflict("That person is already on this project.");
    }

    const id = randomUUID();

    await db.transaction(async (tx) => {
      await this.repository.insert(tx, {
        id,
        projectId: project.id,
        userId: input.userId,
        role: input.role,
      });

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "project_member.added",
        target: input.userId,
        changes: { role: input.role },
      });
    });

    return toProjectMember(await this.requireMember(project.id, input.userId));
  }

  async updateRole(
    context: ProjectMemberActorContext,
    projectKey: string,
    userId: string,
    input: UpdateProjectMemberInput,
  ): Promise<ProjectMember> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "admin",
    });

    await this.requireMember(project.id, userId);

    await db.transaction(async (tx) => {
      await this.repository.updateRole(tx, project.id, userId, input.role);

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "project_member.updated",
        target: userId,
        changes: { role: input.role },
      });
    });

    return toProjectMember(await this.requireMember(project.id, userId));
  }

  async remove(
    context: ProjectMemberActorContext,
    projectKey: string,
    userId: string,
  ): Promise<{ userId: string; removed: true }> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "admin",
    });

    // Removing somebody who is not a member is a 404, not a silent success.
    await this.requireMember(project.id, userId);

    await db.transaction(async (tx) => {
      await this.repository.remove(tx, project.id, userId);

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "project_member.removed",
        target: userId,
      });
    });

    return { userId, removed: true };
  }

  private async requireMember(
    projectId: string,
    userId: string,
  ): Promise<ProjectMemberRow> {
    const row = await this.repository.find(projectId, userId);

    if (!row) {
      throw ApiError.notFound("That person is not a member of this project.");
    }

    return row;
  }
}
